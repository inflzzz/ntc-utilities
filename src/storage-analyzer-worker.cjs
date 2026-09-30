const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const v8 = require('node:v8');
const { parentPort } = require('node:worker_threads');
const { CompactStorageModel, TYPE } = require('./storage-analyzer-core.cjs');

let model = null;
let scanState = null;

function cancelled() { return scanState?.cancelView && Atomics.load(scanState.cancelView, 0) === 1; }
function allocatedBytes(stat) {
  const blocks = Number(stat.blocks), logical = Number(stat.size), allocated = blocks * 512;
  if (Number.isFinite(blocks) && blocks >= 0 && Number.isSafeInteger(allocated) && allocated <= logical + 1024 * 1024) return { value: allocated, estimated: false };
  return { value: logical, estimated: true };
}
function postProgress(force = false) {
  if (!scanState) return;
  const now = Date.now();
  if (!force && now - scanState.lastProgress < 250) return;
  scanState.lastProgress = now;
  const memoryStart = performance.now();
  const memoryBytes = model.memoryEstimate();
  if (scanState.profileEnabled) scanState.profile.progressMemoryEstimateMs += performance.now() - memoryStart;
  const currentPath = scanState.currentDirectoryId >= 0 ? model.itemPath(scanState.currentDirectoryId) : scanState.currentPath;
  const message = { type: 'progress', payload: { status: 'scanning', rootPath: model.rootPath, files: scanState.files, folders: scanState.folders, links: scanState.links, logical: scanState.logical, allocated: scanState.allocated, errors: model.errors.length, elapsedMs: now - scanState.startedAt, currentPath, memoryBytes } };
  if (scanState.profileEnabled) {
    const serializeStart = performance.now();
    scanState.profile.progressSerializedBytes += v8.serialize(message).byteLength;
    scanState.profile.progressSerializeMs += performance.now() - serializeStart;
    scanState.profile.progressMessages++;
  }
  message.payload.workerSentAtEpochMs = Date.now();
  const sendStart = performance.now();
  parentPort.postMessage(message);
  if (scanState.profileEnabled) scanState.profile.progressPostMessageMs += performance.now() - sendStart;
}

function resetForFallback(rootPath) {
  const previous = scanState;
  model = new CompactStorageModel(rootPath);
  scanState = { ...previous, files: 0, folders: 1, links: 0, logical: 0, allocated: 0, currentPath: rootPath, currentDirectoryId: model.rootId, nativeIds: new Int32Array(0), seenHardLinks: new Set(), nativeChild: null };
}

function scanFallback() {
  const profileEnabled = scanState.profileEnabled;
  const startedAt = scanState.startedAt;
  const stack = [{ path: model.rootPath, id: model.rootId }];
  while (stack.length) {
    if (cancelled()) return false;
    const directory = stack.pop(); scanState.currentPath = directory.path; scanState.currentDirectoryId = -1;
    let entries;
    const enumerateStart = performance.now();
    try { entries = fs.readdirSync(directory.path, { withFileTypes: true }); }
    catch (error) { const errorStart = performance.now(); model.addError({ path: directory.path, code: error.code, message: error.message }); if (profileEnabled) scanState.profile.errorRecordMs += performance.now() - errorStart; if (profileEnabled) scanState.profile.enumerationMs += performance.now() - enumerateStart; postProgress(); continue; }
    if (profileEnabled) { scanState.profile.enumerationMs += performance.now() - enumerateStart; scanState.profile.directoriesEnumerated++; scanState.profile.entriesVisited += entries.length; }
    for (const entry of entries) {
      if (cancelled()) break;
      const pathStart = performance.now();
      const fullPath = path.join(directory.path, entry.name);
      if (profileEnabled) scanState.profile.pathConstructionMs += performance.now() - pathStart;
      let stat;
      const statStart = performance.now();
      try { stat = fs.lstatSync(fullPath, { bigint: true }); if (profileEnabled) { scanState.profile.statMs += performance.now() - statStart; scanState.profile.statCalls++; } }
      catch (error) { if (profileEnabled) { scanState.profile.statMs += performance.now() - statStart; scanState.profile.statCalls++; } const errorStart = performance.now(); model.addError({ path: fullPath, code: error.code, message: error.message }); if (profileEnabled) scanState.profile.errorRecordMs += performance.now() - errorStart; continue; }
      const modified = Number(stat.mtimeMs || 0n);
      if (entry.isSymbolicLink() || stat.isSymbolicLink()) { const insertStart = performance.now(); model.addLink(entry.name, directory.id, modified); if (profileEnabled) scanState.profile.modelInsertMs += performance.now() - insertStart; scanState.links++; continue; }
      if (entry.isDirectory() || stat.isDirectory()) {
        const insertStart = performance.now(); const id = model.addDirectory(entry.name, directory.id, modified); if (profileEnabled) scanState.profile.modelInsertMs += performance.now() - insertStart; scanState.folders++; stack.push({ path: fullPath, id });
      } else if (entry.isFile() || stat.isFile()) {
        const logical = Number(stat.size); const allocationStart = performance.now(); const allocation = allocatedBytes(stat); if (profileEnabled) scanState.profile.allocationMs += performance.now() - allocationStart; let duplicatePhysical = false;
        const hardLinkStart = performance.now();
        if (Number(stat.nlink) > 1) { const key = `${stat.dev}:${stat.ino}`; duplicatePhysical = scanState.seenHardLinks.has(key); if (!duplicatePhysical) scanState.seenHardLinks.add(key); }
        if (profileEnabled) scanState.profile.hardLinkMs += performance.now() - hardLinkStart;
        const insertStart = performance.now(); model.addFile(entry.name, directory.id, logical, allocation.value, modified, duplicatePhysical, allocation.estimated); if (profileEnabled) scanState.profile.modelInsertMs += performance.now() - insertStart;
        scanState.files++; scanState.logical += logical; if (!duplicatePhysical) scanState.allocated += allocation.value;
      }
    }
    postProgress();
  }
  return !cancelled();
}

function win32Code(error) {
  if (error === 2 || error === 3) return 'ENOENT';
  if (error === 5) return 'EACCES';
  if (error === 32 || error === 33) return 'EBUSY';
  if (error === 206) return 'ENAMETOOLONG';
  if (error === 112) return 'ENOSPC';
  return `WIN32_${error}`;
}

function nativeAllocation(logical, raw) {
  const allocated = Number(raw);
  const valid = Number.isFinite(allocated) && allocated >= 0 && Number.isSafeInteger(allocated) && allocated <= logical + 1024 * 1024;
  return { value: valid ? allocated : logical, estimated: !valid };
}

function nativeModelId(nativeId) {
  if (!Number.isInteger(nativeId) || nativeId < 0) return -1;
  let ids = scanState.nativeIds;
  if (nativeId >= ids.length) {
    let capacity = ids.length;
    while (capacity <= nativeId) capacity *= 2;
    const next = new Int32Array(capacity); next.set(ids); scanState.nativeIds = ids = next;
  }
  return ids[nativeId] - 1;
}

function bindNativeId(nativeId, modelId) {
  let ids = scanState.nativeIds;
  if (nativeId >= ids.length) {
    let capacity = ids.length;
    while (capacity <= nativeId) capacity *= 2;
    const next = new Int32Array(capacity); next.set(ids); scanState.nativeIds = ids = next;
  }
  ids[nativeId] = modelId + 1;
}

function displayNativePath(value) {
  const source = String(value || '');
  if (source.startsWith('\\\\?\\UNC\\')) return `\\\\${source.slice(8)}`;
  return source.startsWith('\\\\?\\') ? source.slice(4) : source;
}

function scanWithNativeHelper(helperPath, rootPath) {
  return new Promise(resolve => {
    const started = performance.now();
    let child, failureReason = '', stderr = '';
    try { child = spawn(helperPath, [rootPath], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { resolve({ ok: false, sawEntry: false, cancelled: cancelled(), reason: `spawn_failed:${error.code || error.message}` }); return; }
    scanState.nativeChild = child;
    let buffer = Buffer.alloc(0), sawDone = false, failed = false, sawEntry = false, closed = false;
    const cancelTimer = setInterval(() => { if (!closed && cancelled()) child.kill(); }, 40);
    const processRecord = record => {
      const decodeStart = performance.now();
      const kind = record.readUInt8(0), id = record.readInt32LE(1), parentId = record.readInt32LE(5);
      const rawSize = record.readBigInt64LE(9), rawAllocation = record.readBigInt64LE(17), rawModified = record.readBigInt64LE(25);
      const fileId = record.readBigUInt64LE(33), attributes = record.readUInt32LE(41), nameLength = record.readUInt16LE(45);
      const name = nameLength ? record.toString('utf16le', 47, 47 + nameLength * 2) : '';
      scanState.profile.nativeRecordDecodeMs += performance.now() - decodeStart;
      if (kind === 6) {
        if (id === 0) bindNativeId(id, model.rootId);
        const modelId = nativeModelId(id);
        if (modelId < 0) { failed = true; return; }
        scanState.currentDirectoryId = modelId;
        scanState.profile.directoriesEnumerated++;
        return;
      }
      if (kind === 5) {
        scanState.profile.nativeDirectoriesOpened = id;
        scanState.profile.nativeBatchCalls = parentId;
        scanState.profile.nativeApiMs = +(Number(rawSize) / 10000).toFixed(2);
        scanState.profile.nativeHelperWallMs = +(Number(rawAllocation) / 10000).toFixed(2);
        scanState.profile.nativeHelperCpuMs = +(Number(rawModified) / 10000).toFixed(2);
        scanState.profile.nativeHelperPeakRssBytes = Number(fileId);
        sawDone = true; return;
      }
      if (kind === 8) {
        failureReason = `helper_reported_scan_error:${Number(rawSize)}${name ? `:${name}` : ''}`;
        failed = true; return;
      }
      if (kind === 4) {
        const parentModelId = nativeModelId(parentId);
        if (parentModelId < 0) { failed = true; return; }
        const errorStart = performance.now(); model.addError({ path: displayNativePath(name) || model.itemPath(parentModelId), code: win32Code(Number(rawSize)), message: 'Não foi possível enumerar este diretório.' });
        scanState.profile.errorRecordMs += performance.now() - errorStart; return;
      }
      if (kind !== 1 && kind !== 2 && kind !== 3 && kind !== 7) { failureReason = `invalid_helper_record_kind:${kind}`; failed = true; return; }
      const parentModelId = nativeModelId(parentId);
      if (parentModelId < 0 || nativeModelId(id) >= 0) { failureReason = 'invalid_helper_parent_or_duplicate_id'; failed = true; return; }
      sawEntry = true;
      scanState.profile.entriesVisited++;
      const modified = Number(rawModified) / 10000 - 11644473600000;
      const insertStart = performance.now();
      let modelId;
      if (kind === 3) { modelId = model.addLink(name, parentModelId, modified); scanState.links++; }
      else if (kind === 1) { modelId = model.addDirectory(name, parentModelId, modified); scanState.folders++; }
      else if (kind === 7) {
        const specialPath = path.join(model.itemPath(parentModelId), name);
        const statStart = performance.now();
        let stat;
        try { stat = fs.lstatSync(specialPath, { bigint: true }); }
        catch (error) {
          scanState.profile.reparseLstatErrors++;
          model.addError({ path: specialPath, code: error.code, message: error.message });
          scanState.profile.errorRecordMs += performance.now() - insertStart;
          scanState.profile.reparseLstatMs += performance.now() - statStart;
          return;
        }
        scanState.profile.reparseLstatMs += performance.now() - statStart;
        scanState.profile.reparseLstatCalls++;
        const exactModified = Number(stat.mtimeMs || 0n);
        if (stat.isSymbolicLink()) { modelId = model.addLink(name, parentModelId, exactModified); scanState.links++; }
        else if (stat.isFile()) {
          const logical = Number(stat.size), allocation = nativeAllocation(logical, rawAllocation);
          const hardLinkKey = fileId !== 0n ? fileId.toString() : `${stat.dev}:${stat.ino}`;
          const canBeHardLink = fileId !== 0n || Number(stat.nlink) > 1;
          const duplicatePhysical = canBeHardLink && scanState.seenHardLinks.has(hardLinkKey);
          if (canBeHardLink && !duplicatePhysical) scanState.seenHardLinks.add(hardLinkKey);
          modelId = model.addFile(name, parentModelId, logical, duplicatePhysical ? 0 : allocation.value, exactModified, duplicatePhysical, allocation.estimated);
          scanState.files++; scanState.logical += logical; if (!duplicatePhysical) scanState.allocated += allocation.value;
          if (scanState.verifyNative) {
            const fallbackAllocation = allocatedBytes(stat), fallbackKey = `${stat.dev}:${stat.ino}`;
            const fallbackDuplicate = Number(stat.nlink) > 1 && scanState.verifyHardLinks.has(fallbackKey);
            if (Number(stat.nlink) > 1 && !fallbackDuplicate) scanState.verifyHardLinks.add(fallbackKey);
            const logicalDelta = Number(stat.size) - logical;
            scanState.profile.verifyReparseFiles++;
            scanState.profile.verifyReparseLogicalMismatch += logicalDelta !== 0 ? 1 : 0;
            scanState.profile.verifyReparseLogicalDeltaBytes += logicalDelta;
            scanState.profile.verifyReparseNativeAllocatedBytes += duplicatePhysical ? 0 : allocation.value;
            scanState.profile.verifyReparseFallbackAllocatedBytes += fallbackDuplicate ? 0 : fallbackAllocation.value;
            scanState.profile.verifyReparseAllocationMismatch += allocation.value !== fallbackAllocation.value ? 1 : 0;
            scanState.profile.verifyReparseDuplicateNative += duplicatePhysical ? 1 : 0;
            scanState.profile.verifyReparseDuplicateFallback += fallbackDuplicate ? 1 : 0;
          }
        } else {
          // Reparse directories are kept as links and are never traversed, matching the helper's safe no-follow policy.
          modelId = model.addLink(name, parentModelId, exactModified); scanState.links++;
        }
      }
      else {
        const logical = Number(rawSize), allocation = nativeAllocation(logical, rawAllocation);
        const duplicatePhysical = fileId !== 0n && scanState.seenHardLinks.has(fileId.toString());
        if (!duplicatePhysical && fileId !== 0n) scanState.seenHardLinks.add(fileId.toString());
        modelId = model.addFile(name, parentModelId, logical, duplicatePhysical ? 0 : allocation.value, modified, duplicatePhysical, allocation.estimated);
        scanState.files++; scanState.logical += logical; if (!duplicatePhysical) scanState.allocated += allocation.value;
        if (scanState.verifyNative) {
          try {
            const stat = fs.lstatSync(path.join(model.itemPath(parentModelId), name), { bigint: true });
            const fallbackSize = Number(stat.size), fallbackAllocation = allocatedBytes(stat);
            const fallbackHardlinkKey = `${stat.dev}:${stat.ino}`;
            const fallbackDuplicate = Number(stat.nlink) > 1 && scanState.verifyHardLinks.has(fallbackHardlinkKey);
            if (Number(stat.nlink) > 1 && !fallbackDuplicate) scanState.verifyHardLinks.add(fallbackHardlinkKey);
            scanState.profile.verifyFiles++;
            scanState.profile.verifyLogicalMismatch += fallbackSize !== logical ? 1 : 0;
            scanState.profile.verifyLogicalDeltaBytes += fallbackSize - logical;
            scanState.profile.verifyFallback512RoundMatches += fallbackAllocation.value === Math.ceil(fallbackSize / 512) * 512 ? 1 : 0;
            scanState.profile.verifyNativeAllocatedBytes += duplicatePhysical ? 0 : allocation.value;
            scanState.profile.verifyFallbackAllocatedBytes += fallbackDuplicate ? 0 : fallbackAllocation.value;
            const nativeComparable = duplicatePhysical ? 0 : allocation.value, fallbackComparable = fallbackDuplicate ? 0 : fallbackAllocation.value;
            const difference = nativeComparable - fallbackComparable;
            scanState.profile.verifyAllocationMismatch += difference !== 0 ? 1 : 0;
            if (difference > 0) scanState.profile.verifyNativeExtraBytes += difference;
            if (difference < 0) scanState.profile.verifyFallbackExtraBytes -= difference;
            if (attributes & 0x200) scanState.profile.verifySparseFiles++;
            if (attributes & 0x800) scanState.profile.verifyCompressedFiles++;
            if (difference && attributes & 0x200) scanState.profile.verifySparseMismatch++;
            if (difference && attributes & 0x800) scanState.profile.verifyCompressedMismatch++;
            scanState.profile.verifyDuplicateNative += duplicatePhysical ? 1 : 0;
            scanState.profile.verifyDuplicateFallback += fallbackDuplicate ? 1 : 0;
          } catch { scanState.profile.verifyLstatErrors++; }
        }
      }
      bindNativeId(id, modelId);
      scanState.profile.modelInsertMs += performance.now() - insertStart;
    };
    child.stdout.on('data', chunk => {
      if (cancelled()) { child.kill(); return; }
      const handlerStart = performance.now();
      scanState.profile.nativeOutputBytes += chunk.length; scanState.profile.nativeOutputChunks++;
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
      while (buffer.length >= 47) {
        const nameLength = buffer.readUInt16LE(45), recordLength = 47 + nameLength * 2;
        if (buffer.length < recordLength) break;
        processRecord(buffer.subarray(0, recordLength));
        buffer = buffer.subarray(recordLength);
        if (failed) { child.kill(); break; }
      }
      postProgress();
      scanState.profile.nativePipeHandlerMs += performance.now() - handlerStart;
    });
    child.stderr.on('data', chunk => { if (stderr.length < 4096) stderr += chunk.toString('utf8').slice(0, 4096 - stderr.length); });
    child.on('error', error => { failed = true; failureReason = `spawn_error:${error.code || error.message}`; });
    child.on('close', code => {
      closed = true; clearInterval(cancelTimer); scanState.nativeChild = null;
      scanState.profile.nativeParentWallMs = +(performance.now() - started).toFixed(2);
      if (!failureReason && code === 3) failureReason = 'unsupported_filesystem:helper_requires_NTFS';
      else if (!failureReason && code !== 0) failureReason = `helper_exit_code:${code}${stderr.trim() ? `:${stderr.trim()}` : ''}`;
      else if (!failureReason && !sawDone) failureReason = 'helper_finished_without_completion_record';
      else if (!failureReason && buffer.length) failureReason = `truncated_helper_stream:${buffer.length}_bytes_remaining`;
      resolve({ ok: code === 0 && sawDone && !failed && buffer.length === 0, sawEntry, cancelled: cancelled(), reason: failureReason, launched: true, exitCode: code });
    });
  });
}

function sendCancelled(startedAt) {
  postProgress(true);
  parentPort.postMessage({ type: 'cancelled', payload: { status: 'cancelled', rootPath: model.rootPath, files: scanState.files, folders: scanState.folders, links: scanState.links, logical: scanState.logical, allocated: scanState.allocated, errors: model.errors.length, elapsedMs: Date.now() - startedAt } });
}

async function scan(rootPath, cancelBuffer, profileEnabled = false, helperPath = '', verifyNative = false) {
  const startedAt = Date.now();
  model = new CompactStorageModel(rootPath);
  scanState = { startedAt, monotonicStart: performance.now(), lastProgress: 0, files: 0, folders: 1, links: 0, logical: 0, allocated: 0, currentPath: rootPath, currentDirectoryId: model.rootId, nativeIds: new Int32Array(65536), verifyNative: false, verifyHardLinks: new Set(), cancelView: new Int32Array(cancelBuffer), seenHardLinks: new Set(), profileEnabled, nativeChild: null, profile: { directoriesEnumerated: 0, entriesVisited: 0, statCalls: 0, enumerationMs: 0, pathConstructionMs: 0, statMs: 0, allocationMs: 0, hardLinkMs: 0, modelInsertMs: 0, errorRecordMs: 0, reparseLstatMs: 0, reparseLstatCalls: 0, reparseLstatErrors: 0, progressMemoryEstimateMs: 0, progressSerializeMs: 0, progressSerializedBytes: 0, progressPostMessageMs: 0, progressMessages: 0, finalizeMs: 0, summaryMs: 0, nativeUsed: false, nativeFallback: false, nativeFallbackReason: '', helperPath: String(helperPath || ''), helperExists: false, helperLaunchAttempted: false, helperExitCode: null, nativeParentWallMs: 0, nativeHelperWallMs: 0, nativeApiMs: 0, nativeBatchCalls: 0, nativeDirectoriesOpened: 0, nativeHelperCpuMs: 0, nativeHelperPeakRssBytes: 0, nativeOutputBytes: 0, nativeOutputChunks: 0, nativePipeHandlerMs: 0, nativeRecordDecodeMs: 0, fallbackWallMs: 0, fallbackEntriesVisited: 0, workerToMainIpcMs: 0, workerToMainIpcMessages: 0, mainToRendererSendMs: 0, rendererIpcMs: null, verifyFiles: 0, verifyLogicalMismatch: 0, verifyLogicalDeltaBytes: 0, verifyAllocationMismatch: 0, verifyNativeAllocatedBytes: 0, verifyFallbackAllocatedBytes: 0, verifyNativeExtraBytes: 0, verifyFallbackExtraBytes: 0, verifyFallback512RoundMatches: 0, verifySparseFiles: 0, verifyCompressedFiles: 0, verifySparseMismatch: 0, verifyCompressedMismatch: 0, verifyDuplicateNative: 0, verifyDuplicateFallback: 0, verifyReparseFiles: 0, verifyReparseLogicalMismatch: 0, verifyReparseLogicalDeltaBytes: 0, verifyReparseAllocationMismatch: 0, verifyReparseNativeAllocatedBytes: 0, verifyReparseFallbackAllocatedBytes: 0, verifyReparseDuplicateNative: 0, verifyReparseDuplicateFallback: 0, verifyLstatErrors: 0 } };
  scanState.verifyNative = verifyNative;
  let nativeSuccess = false;
  let fallbackReason = '';
  if (process.platform !== 'win32') fallbackReason = `platform_not_supported:${process.platform}`;
  else if (!helperPath) fallbackReason = 'helper_path_not_configured';
  else if (!fs.existsSync(helperPath)) fallbackReason = `helper_not_found:${helperPath}`;
  if (fallbackReason) scanState.profile.helperExists = false;
  else if (process.platform === 'win32') {
    scanState.profile.helperExists = true;
    scanState.profile.helperLaunchAttempted = true;
    const native = await scanWithNativeHelper(helperPath, model.rootPath);
    if (native.cancelled) { sendCancelled(startedAt); return; }
    scanState.profile.helperExitCode = native.exitCode ?? null;
    nativeSuccess = native.ok;
    scanState.profile.nativeUsed = native.ok;
    if (!native.ok) { fallbackReason = native.reason || `helper_failed_exit_code:${native.exitCode}`; scanState.profile.nativeFallback = true; resetForFallback(rootPath); }
  }
  if (!nativeSuccess) {
    scanState.profile.nativeFallback = true;
    scanState.profile.nativeFallbackReason = fallbackReason;
    const fallbackStart = performance.now(), fallbackEntriesStart = scanState.profile.entriesVisited;
    if (!scanFallback()) { sendCancelled(startedAt); return; }
    scanState.profile.fallbackWallMs = performance.now() - fallbackStart;
    scanState.profile.fallbackEntriesVisited = scanState.profile.entriesVisited - fallbackEntriesStart;
  }
  const finalizeStart = performance.now(); model.finalize(); if (profileEnabled) scanState.profile.finalizeMs += performance.now() - finalizeStart;
  const summaryStart = performance.now();
  const summary = model.summary('complete', Date.now() - startedAt);
  if (profileEnabled) {
    scanState.profile.summaryMs += performance.now() - summaryStart;
    scanState.profile.wallMs = performance.now() - scanState.monotonicStart;
    const fallbackStages = scanState.profile.enumerationMs + scanState.profile.pathConstructionMs + scanState.profile.statMs + scanState.profile.allocationMs + scanState.profile.hardLinkMs + scanState.profile.modelInsertMs + scanState.profile.errorRecordMs + scanState.profile.progressMemoryEstimateMs + scanState.profile.progressSerializeMs + scanState.profile.progressPostMessageMs;
    const measured = scanState.profile.nativeParentWallMs > 0
      ? scanState.profile.nativeParentWallMs + scanState.profile.finalizeMs + scanState.profile.summaryMs + (scanState.profile.nativeFallback ? fallbackStages : 0)
      : fallbackStages + scanState.profile.finalizeMs + scanState.profile.summaryMs;
    scanState.profile.unattributedMs = Math.max(0, scanState.profile.wallMs - measured);
    summary.scanMethod = nativeSuccess ? 'fast-ntfs' : 'standard';
    summary.fallbackReason = nativeSuccess ? '' : scanState.profile.nativeFallbackReason;
    summary.profile = { ...scanState.profile };
  } else {
    summary.scanMethod = nativeSuccess ? 'fast-ntfs' : 'standard';
    summary.fallbackReason = nativeSuccess ? '' : scanState.profile.nativeFallbackReason;
  }
  postProgress(true); summary.workerSentAtEpochMs = Date.now(); parentPort.postMessage({ type: 'complete', payload: summary });
}

function answer(requestId, action, payload) {
  try {
    if (!model) throw new Error('Nenhuma análise disponível.');
    let result;
    if (action === 'query') result = model.query(payload);
    else if (action === 'treemap') result = model.treemap(Number(payload?.rootId ?? model.rootId), payload?.filters || {}, payload?.maxNodes || 5000, payload?.sizeKey);
    else if (action === 'types') result = model.typeBreakdown();
    else if (action === 'findings') result = model.findings();
    else if (action === 'item') result = model.item(Number(payload?.id));
    else if (action === 'summary') result = model.summary('complete', Date.now() - (scanState?.startedAt || Date.now()));
    else if (action === 'remove') result = { removed: model.removeItem(Number(payload?.id)), summary: model.summary('complete', Date.now() - (scanState?.startedAt || Date.now())) };
    else throw new Error('Operação desconhecida.');
    parentPort.postMessage({ type: 'rpc', requestId, result });
  } catch (error) { parentPort.postMessage({ type: 'rpc', requestId, error: error.message }); }
}

parentPort.on('message', message => {
  if (message?.type === 'scan') scan(message.rootPath, message.cancelBuffer, message.profile === true, message.helperPath || '', message.verifyNative === true).catch(error => parentPort.postMessage({ type: 'failure', payload: { status: 'error', message: error.message } }));
  else if (message?.type === 'rpc') answer(message.requestId, message.action, message.payload || {});
});
parentPort.postMessage({ type: 'ready' });
