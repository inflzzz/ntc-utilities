# Scanner performance pass

## Scope

This pass changes only the Storage Analyzer scanner and its packaging/test hooks. It does not change the treemap appearance, add a cache, or alter other NTC tools. The benchmark is read-only; the report contains aggregate counts only.

## Baseline and result

The original scanner synchronously walked each directory, called `readdirSync`, then called `lstatSync` once per entry, built the compact JS model, and sent throttled progress from a worker. There was no per-file Electron IPC and no persistent scan cache.

Measurements were made against the same local NTFS volume with the standard scanner and the packaged helper. The earlier reported workload of about 932,000 entries was not available in this workspace, so it is not claimed as the benchmark dataset.

| Metric | Standard scanner | Packaged fast scan |
| --- | ---: | ---: |
| Files | 391,447 | 391,447 |
| Folders (excluding root) | 34,390 | 34,390 |
| Links | 31 | 31 |
| Entries | 425,869 | 425,869 |
| Logical bytes | 374,710,633,904 | 374,710,633,904 |
| Allocated bytes | 375,379,362,399 | 375,389,566,608 |
| Access errors | 1 | 1 |
| Wall time | 9.289 s | 1.699 s |
| Throughput | 45,849 entries/s | 250,673 entries/s |

The paired measurement is 5.47× faster (81.7% less wall time). Repeated standard runs varied from 7.34–9.29 s and fast runs from 1.63–1.84 s as filesystem cache state changed; the conservative comparison is about 4.0× faster / 75% less time.

The 10,204,209-byte allocated-size increase is 0.0027% of the standard total. A read-only per-file verification found zero logical-size mismatches and the same 209 hard-link duplicates; the difference is in the old fallback's `stat`-derived allocation estimate versus NTFS `AllocationSize`, which is the filesystem's cluster allocation. NTFS defines that field as an allocation size that is a multiple of the cluster size. This small measurement difference is retained rather than degrading the direct disk-allocation value to force equality.

## Profile

Standard scanner, 9.289 s wall time:

| Stage | Time |
| --- | ---: |
| Directory enumeration | 1.880 s |
| Path construction | 1.337 s |
| `lstat` (425,868 calls) | 5.171 s |
| Allocation conversion | 0.042 s |
| Hard-link handling | 0.026 s |
| Model insertion | 0.412 s |
| Progress memory estimate | 0.121 s |
| Progress serialization + postMessage | 0.002 s |
| Finalize + summary | 0.026 s |
| Other/unattributed | 0.220 s |

On the fast scan, `lstat` calls fall to zero. The helper's directory API took 0.724 s in aggregate; the helper process took 1.471 s wall / 3.500 CPU-seconds across its bounded workers. The JS model insertion took 0.563 s within a 1.620 s helper/pipe pipeline. The binary stream was 39.5 MB across 603 stdout chunks (not Electron IPC). Progress fell from 37 messages / 10.7 KB to 6 / 1.7 KB. No per-entry renderer IPC was introduced.

The standard run used about 9.5 CPU-seconds in the Node process, with 294 MB peak RSS and a 36.2 MB model estimate. In the fast run, Node used 1.67 CPU-seconds and peaked at 282 MB RSS; the separate helper peaked at 34.7 MB RSS. Peak samples are independent and should not be added as an exact simultaneous measurement.

## Architecture and correctness

- The Windows helper is a small C#/.NET executable using `GetFileInformationByHandleEx(FileIdBothDirectoryInfo)` to receive filename, logical size, allocation size, attributes, timestamps, and file ID in directory batches. Microsoft documents the `AllocationSize` and `FileId` fields in [`FILE_ID_BOTH_DIR_INFO`](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_both_dir_info).
- It checks that the target volume is NTFS. Raw MFT enumeration was evaluated but not selected: WizTree documents that its high-speed MFT mode requires Administrator rights; the NTC helper only opens directories for listing and does not require elevation. Microsoft documents raw MFT enumeration through [`FSCTL_ENUM_USN_DATA`](https://learn.microsoft.com/en-us/windows/win32/api/winioctl/ni-winioctl-fsctl_enum_usn_data).
- The implementation does not copy code from WizTree or SpaceSharp. SpaceSharp was reviewed as an open-source comparison; its repository is [here](https://github.com/ClearanceClarence/SpaceSharp).
- Four worker threads are used as a fixed upper bound to overlap directory I/O without issuing unbounded operations. Only one local NTFS volume was benchmarked; HDD/SATA/NVMe-specific tuning remains unvalidated.
- The helper deduplicates hard links by volume file ID. Directory junctions/reparse points are listed but never traversed. File reparse points are classified with a targeted `lstat` on that path; one such entry does not discard the native model or trigger a second full-tree walk.
- Logical size and direct NTFS allocation metadata are used; sparse files are covered by tests. No compressed files were present in the real benchmark. Filesystem changes during an active scan remain subject to the usual point-in-time enumeration race.
- Long paths use extended Windows paths. Per-directory access errors are retained. Missing, unsupported, malformed, or unexpectedly exiting helpers record a precise fallback reason, reset the partial native model, and use the existing `lstat` fallback. Cancellation signals and kills the child, then the worker reports cancellation after the child closes. App shutdown waits for an active scan's disposal before quitting.
- The helper is built for packaging, included under `resources/bin`, and located separately for development and packaged Electron. No package dependency was added. Other filesystems keep the original scanner.
- The current model remains in the worker for browsing/drill-down, so navigating folders does not rescan. There is no incremental USN cache or saved snapshot; none was added to avoid presenting stale data as current.

## Synthetic scaling and validation

The model benchmark creates synthetic entries in memory rather than creating one million files on disk:

| Entries | Elapsed | Model estimate | JS heap delta |
| ---: | ---: | ---: | ---: |
| 10,011 | 27.65 ms | 0.69 MB | 1.79 MB |
| 100,101 | 89.24 ms | 7.08 MB | 18.38 MB |
| 1,001,001 | 787.45 ms | 72.84 MB | 95.33 MB |

The Storage Analyzer tests cover the standard scanner; native/fallback comparisons for sparse files, hard links, long paths, and junctions; targeted file-reparse classification where symlink creation is permitted; missing/crashing helper fallback; and native-helper cancellation. The full NTC suite and Windows builds were also run.

## Installed-app investigation — 2026-09-29

The user's reported whole-volume scan was reproduced on `C:\`. The existing Start Menu shortcut points to `C:\Users\Administrator\Desktop\kkk\NTC Utilities\NTC Utilities.exe`; that installed copy had no `resources\bin\storage-scan-fast.exe`. This is why a development/unpacked benchmark did not represent the installed app: the worker silently chose the standard scanner when the packaged helper was absent.

| C:\ profile | Standard path from the existing install | Helper from an isolated NSIS install |
| --- | ---: | ---: |
| Entries | 837,087 | 837,108 |
| Wall time | 49.862 s | 5.002 s |
| Method | Scanner padrão | Fast Scan (NTFS) |
| Helper found/launched | No / No | Yes / Yes, exit code 0 |
| Fallback full-tree entries | 837,088 | 0 |

The standard-path stage profile was 7.694 s enumeration, 35.358 s across 837,088 `lstat` calls, 3.358 s path construction, 1.049 s model insertion, 1.351 s progress-memory estimation, about 0.062 s finalization/summary, and about 0.556 s unattributed. The scanner reported 10 inaccessible entries. The previous app did not persist per-scan telemetry, so the historical ~54 s cannot be profiled retroactively; this 49.862 s reproduction used the same whole-volume path and directly confirmed the silent helper-missing fallback.

The helper was then measured from `resources\bin` in an isolated, installed NSIS package (not a developer-only `win-unpacked` directory): 4.725 s helper wall time, 4.887 s parent/pipe pipeline, 3.956 s accumulated NTFS API time across concurrent workers, and 1.186 s JS model insertion, totaling 5.002 s. It emitted 137 MB in 2,091 helper-output chunks. The scan used Fast Scan throughout, with no standard-scanner fallback; only 27 file reparse points received localized `lstat` calls (5 ms total). The scan results differed by 21 entries, primarily because the standard `lstat` path cannot stat `pagefile.sys` and `swapfile.sys` on this machine (`EINVAL`), while the NTFS directory records include their sizes (22,242,373,632 and 16,777,216 bytes respectively). Thus, in this test, the native path was both materially faster and more complete for these protected system-file entries.

The command-line profiling runs do not pass through Electron's main/renderer bridge, so they cannot produce real UI IPC timings. The app now records worker→main and main→renderer send time and the renderer's completion-delivery delay in the completed scan profile/tooltip. Those values should be read from a scan run in the updated app; the old installed copy did not have this instrumentation. The concise completed-scan label is `Fast Scan (NTFS)` or `Scanner padrão`; hovering it exposes helper discovery/launch/exit, exact fallback reason, stage profile, output volume, and IPC timings.
