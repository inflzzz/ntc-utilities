/* Presentation only. No access to the RNG, IPC, player state mutations or saves. */
(() => {
  'use strict';
  const WEIGHTS = Object.freeze({ basic: 62, epic: 25, unique: 9, legendary: 3, mythic: .75, exalted: .18, glorious: .06, transcendent: .009, dimensional: .0009, ntc: .0001 });
  const DURATIONS = [3400, 3550, 3700, 3900, 4150, 4350, 4550, 4800, 5050, 5400];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function randomSource(seed) {
    let value = seed >>> 0;
    return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
  }
  function sample(tiers, random) {
    const total = tiers.reduce((sum, tier) => sum + (WEIGHTS[tier.id] || 0), 0);
    let choice = random() * total;
    for (const tier of tiers) { choice -= WEIGHTS[tier.id] || 0; if (choice < 0) return tier; }
    return tiers[0];
  }
  // Integrated t(1-t)^3 velocity: early acceleration and a long, continuous approach.
  // The second term carries the actual entry velocity through interruptions.
  function trajectory(start, end, entryVelocity, duration, elapsed) {
    const t = clamp(elapsed / duration, 0, 1), remaining = 1 - t;
    const progress = 10*t*t - 20*t*t*t + 15*t**4 - 4*t**5;
    const carry = entryVelocity * duration / 1000;
    return {
      position: start + (end-start)*progress + carry*t*remaining**4,
      velocity: ((end-start)*20*t*remaining**3 + carry*remaining**3*(1-5*t)) * 1000/duration
    };
  }

  class RollExperienceController {
    constructor({ root, onResult = () => {}, onRevealReady = () => {}, onCycleComplete = () => {}, clock = {} }) {
      this.root = root;
      this.canvas = root.querySelector('canvas');
      this.context = this.canvas.getContext('2d', { alpha: false });
      this.phaseLabel = root.querySelector('[data-roll-phase-label]');
      this.modeLabel = root.querySelector('[data-roll-mode-label]');
      this.onResult = onResult;
      this.onRevealReady = onRevealReady;
      this.onCycleComplete = onCycleComplete;
      this.now = clock.now || (() => performance.now());
      this.requestFrame = clock.request || (callback => requestAnimationFrame(callback));
      this.cancelFrame = clock.cancel || (id => cancelAnimationFrame(id));
      this.random = randomSource(0x4e5443 ^ Date.now());
      this.position = 0; this.velocity = 0; this.frame = null; this.lastTime = null;
      this.plan = null; this.phase = 'idle'; this.auto = false; this.visible = true; this.occluded = false;
      this.motion = 'full'; this.tiers = []; this.labels = new Map(); this.arrivals = new Map();
      this.latest = null; this.lastRoll = null; this.basicRun = 0; this.rank = 0; this.pulseUntil = 0; this.finishAfterPulse = false;
      this.destroyed = false; this.width = 0; this.height = 0;
      this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
      this.resizeObserver?.observe(root);
      this.resize();
    }

    setPhase(phase) {
      if (this.phase === phase && this.root.dataset.phase === phase) return;
      this.phase = phase; this.root.dataset.phase = phase;
      const labels = { idle: 'À espera do acaso', starting: 'O selo desperta', rolling: 'As possibilidades se movem', anticipating: 'O selo está cedendo', settling: 'Uma possibilidade permanece', result: 'Resultado firmado', 'auto-flow': 'O acaso continua', transitioning: 'Uma descoberta se aproxima' };
      this.phaseLabel.textContent = labels[phase] || labels.idle;
    }

    finishCycleAfterPulse() {
      this.finishAfterPulse = true;
      this.flushCycleCompletion(this.now());
    }

    flushCycleCompletion(now) {
      if (!this.finishAfterPulse || (this.visible && this.motion !== 'off' && this.pulseUntil > now)) return;
      this.finishAfterPulse = false;
      queueMicrotask(() => { if (!this.destroyed) this.onCycleComplete(); });
    }

    setMotion(motion) {
      if (motion === this.motion) return;
      this.motion = motion;
      if (motion !== 'full') {
        const plan = this.plan; this.plan = null; this.arrivals.clear(); this.velocity = 0;
        this.presentImmediately(plan?.result || this.latest);
        if (plan?.reveal) this.handoff();
        else if (plan && !this.auto) this.finishCycleAfterPulse();
      }
      this.ensureFrame();
    }

    setVisible(visible) {
      if (this.visible === visible) return;
      this.visible = visible;
      if (!visible) {
        const cancelledPlan = this.plan;
        const needsReveal = cancelledPlan?.reveal;
        this.plan = null; this.arrivals.clear(); this.velocity = 0; this.cancel();
        if (this.latest) this.presentImmediately(this.latest);
        if (needsReveal) this.handoff();
        else if (cancelledPlan && !this.auto) this.finishCycleAfterPulse();
      } else {
        this.resize(); this.presentImmediately(this.latest);
        if (this.auto && !this.occluded) this.setPhase('auto-flow');
        this.ensureFrame();
      }
    }

    setOccluded(occluded) {
      this.occluded = occluded;
      if (occluded) { this.plan = null; this.arrivals.clear(); this.velocity = 0; this.cancel(); }
      else { this.presentImmediately(this.latest); if (this.auto) this.setPhase('auto-flow'); this.ensureFrame(); }
    }

    beginRequest() {
      if (this.occluded || this.auto) return;
      this.pulseUntil = this.motion === 'off' ? 0 : this.now() + 250;
      this.setPhase('starting'); this.draw(this.now()); this.ensureFrame();
    }

    requestFailed() {
      if (!this.plan) this.setPhase(this.latest ? 'result' : 'idle');
      this.ensureFrame();
    }

    update(state, { reveal = false, discoveryResult = null, motion = this.motion, visible = this.visible } = {}) {
      if (this.destroyed || !state?.tiers?.length) return;
      this.tiers = state.tiers;
      this.setMotion(motion);
      this.setVisible(visible);
      const wasAuto = this.auto;
      this.auto = Boolean(state.autoRollActive);
      if (!wasAuto && this.auto && this.plan && !this.plan.reveal) {
        this.advancePlan(this.now());
        this.plan = null;
        this.finishCycleAfterPulse();
      }
      this.modeLabel.textContent = this.auto ? 'FLUXO AUTOMÁTICO' : 'INVOCAÇÃO MANUAL';
      const result = state.latestResult;
      const newResult = result && this.lastRoll !== null && Number(result.roll) > Number(this.lastRoll);
      const initial = this.lastRoll === null;
      if (result) { this.latest = result; this.lastRoll = Math.max(Number(this.lastRoll) || 0, Number(result.roll)); }
      else if (initial) this.lastRoll = Number(state.totalRolls) || 0;

      if (initial) this.presentImmediately(result);
      else if (newResult) {
        if (!this.visible || this.occluded || this.motion !== 'full') {
          this.presentImmediately(result);
          if (this.motion === 'reduced' && this.visible && !this.occluded) this.pulseUntil = this.now()+180;
          if (reveal && !this.occluded) this.handoff();
          else if (!this.auto) this.finishCycleAfterPulse();
        } else if (this.plan?.reveal) {
          // The existing discovery owns the scene until the reveal takes over.
          // Every eligible event is already retained in the application's FIFO queue.
        } else if (!this.auto || reveal) this.startJourney(reveal && discoveryResult ? discoveryResult : result, reveal);
        else {
          // Ordinary auto results follow the existing flow; they never restart its clock.
          if (this.arrivals.size >= 8) {
            const dropped = Math.max(...this.arrivals.keys());
            this.arrivals.delete(dropped); this.labels.delete(dropped);
          }
          const lastIndex = Math.max(this.position, ...this.arrivals.keys());
          const target = Math.max(Math.ceil(this.position+this.hiddenLead()), Math.floor(lastIndex)+1);
          this.arrivals.set(target, result);
          this.labels.set(target, this.tierFor(result));
        }
      }
      if (!this.occluded && this.visible && this.motion === 'full') {
        if (this.auto && !this.plan) this.setPhase('auto-flow');
        if (!this.auto && wasAuto && !this.plan) this.startJourney(this.latest, false, true);
      }
      if (reveal && !this.plan && !this.occluded && (!newResult || initial)) this.handoff();
      this.ensureFrame();
    }

    tierFor(result) { return this.tiers.find(tier => tier.id === result?.title?.tier) || this.tiers[0]; }
    hiddenLead() { return Math.max(3, Math.ceil(Math.max(295,this.width*.57)*1.55/132)); }

    startJourney(result, reveal, stopping = false) {
      if (!result) return;
      const now = this.now();
      if (this.plan) this.advancePlan(now);
      if (this.occluded) return;
      const queuedTarget = stopping ? [...this.arrivals].find(([, entry]) => entry.roll === result.roll)?.[0] : null;
      this.arrivals.clear();
      const rank = Math.max(0, this.tiers.findIndex(tier => tier.id === result.title.tier));
      let target = queuedTarget;
      if (stopping && !target) {
        target = [...this.labels].filter(([index,tier]) => index > this.position+1 && tier?.id === result.title.tier).sort((a,b)=>a[0]-b[0])[0]?.[0];
      }
      target ??= Math.ceil(this.position + Math.max(this.hiddenLead(), this.auto ? 4 : 8));
      let duration = stopping ? clamp((target-this.position)*440,700,2400)
        : this.auto ? clamp((target-this.position)/2.4*1000+rank*180,1800,4600) : DURATIONS[rank] || 3400;
      // A rapid interruption must never make the inherited momentum overshoot and reverse.
      if (this.velocity > 0) duration = Math.min(duration, 4900*(target-this.position)/this.velocity);
      this.labels.set(target, this.tierFor(result));
      this.rank = rank; this.root.dataset.rank = String(rank);
      this.plan = { start: this.position, target, velocity: this.velocity, started: now, duration, result, reveal };
      this.setPhase('rolling'); this.ensureFrame();
    }

    presentImmediately(result) {
      if (result) {
        this.position = Math.round(this.position);
        this.labels.set(this.position, this.tierFor(result));
        this.rank = Math.max(0, this.tiers.findIndex(tier => tier.id === result.title.tier));
        this.root.dataset.rank = String(this.rank);
        this.onResult(result);
      }
      this.setPhase(result ? 'result' : 'idle'); this.draw(this.now());
    }

    handoff() {
      this.setPhase('transitioning'); this.draw(this.now());
      this.onRevealReady();
    }

    advancePlan(now) {
      const plan = this.plan;
      if (!plan) return;
      const elapsed = now-plan.started;
      const point = trajectory(plan.start, plan.target, plan.velocity, plan.duration, elapsed);
      this.position = point.position; this.velocity = Math.max(0, point.velocity);
      const progress = elapsed/plan.duration;
      this.setPhase(progress > .72 ? 'settling' : progress > .38 && this.rank >= 3 ? 'anticipating' : 'rolling');
      if (progress >= 1) {
        this.position = plan.target; this.velocity = 0; this.plan = null;
        this.onResult(plan.result); this.setPhase('result'); this.pulseUntil = now+220;
        if (plan.reveal) this.handoff();
        else if (this.auto) this.setPhase('auto-flow');
        if (!plan.reveal && !this.auto) this.finishCycleAfterPulse();
      }
    }

    tick(now) {
      this.frame = null;
      if (this.destroyed || !this.visible || this.occluded) return;
      const dt = Math.min(.05, Math.max(0, (now-(this.lastTime ?? now))/1000));
      this.lastTime = now;
      if (this.plan) this.advancePlan(now);
      else if (this.auto && this.motion === 'full') {
        const before = this.position;
        const nextVelocity = this.velocity + (2.4-this.velocity)*(1-Math.exp(-dt/.22));
        this.position += (this.velocity+nextVelocity)*.5*dt; this.velocity = nextVelocity;
        for (const [index, result] of this.arrivals) {
          if (index > before && index <= this.position) {
            this.arrivals.delete(index); this.onResult(result); this.pulseUntil = now+150;
          }
        }
      }
      this.draw(now);
      this.flushCycleCompletion(now);
      this.ensureFrame();
    }

    ensureFrame() {
      const active = this.plan || (this.auto && this.motion === 'full') || this.pulseUntil > this.now();
      if (!this.destroyed && this.visible && !this.occluded && active && this.frame === null) {
        this.frame = this.requestFrame(now => this.tick(now));
      } else if (!active) this.lastTime = null;
    }
    cancel() { if (this.frame !== null) this.cancelFrame(this.frame); this.frame = null; this.lastTime = null; }
    dispose() { this.destroyed = true; this.cancel(); this.resizeObserver?.disconnect(); this.labels.clear(); this.arrivals.clear(); }

    resize() {
      const width = this.root.clientWidth;
      if (!width) return;
      this.width = width; this.height = this.canvas.clientHeight || 280;
      const dpr = Math.min(globalThis.devicePixelRatio || 1, 1.5);
      this.canvas.width = Math.round(width*dpr); this.canvas.height = Math.round(this.height*dpr);
      this.context.setTransform(dpr,0,0,dpr,0,0);
      this.draw(this.now());
    }

    labelAt(index) {
      if (!this.labels.has(index)) {
        let tier = sample(this.tiers, this.random);
        if (tier?.id === 'basic' && this.basicRun >= 4) tier = this.tiers.find(item => item.id === 'epic') || tier;
        this.basicRun = tier?.id === 'basic' ? this.basicRun+1 : 0;
        this.labels.set(index, tier);
      }
      return this.labels.get(index);
    }

    draw(now) {
      if (!this.width || !this.context || !this.tiers.length) return;
      const ctx = this.context, width = this.width, height = this.height, cx = width/2;
      const radius = Math.max(295, width*.57), depth = 170, top = 88, step = 132/radius;
      const approach = this.plan ? clamp((now-this.plan.started)/this.plan.duration,0,1) : 0;
      const tension = this.rank >= 3 ? Math.sin(Math.PI/2*clamp((approach-.2)/.6,0,1))**2 : 0;
      const energy = .18+tension*(.22+this.rank*.035);
      const pulse = clamp((this.pulseUntil-now)/220,0,1);
      ctx.clearRect(0,0,width,height);
      ctx.fillStyle = '#100e10'; ctx.fillRect(0,0,width,height);
      const wash = ctx.createLinearGradient(0,0,width,height);
      wash.addColorStop(0,'#181315'); wash.addColorStop(.5,'#100e10'); wash.addColorStop(1,'#1b1316');
      ctx.fillStyle=wash; ctx.fillRect(0,0,width,height);
      // Etched concentric arcs: an instrument, not a row of cards.
      for (const inset of [0,7,24,30]) {
        ctx.beginPath(); ctx.ellipse(cx,top+depth+34,radius+inset,depth+inset,0,Math.PI,Math.PI*2);
        ctx.strokeStyle = inset === 7 ? '#4c363a' : '#30262a'; ctx.lineWidth=1; ctx.stroke();
      }
      // Only a real rare result awakens the engraving. No decorative near-miss effect.
      if (tension > 0) {
        const spread=.16+tension*.72;
        ctx.save(); ctx.globalAlpha=tension;
        const light=ctx.createLinearGradient(cx-radius,0,cx+radius,0);
        light.addColorStop(0,'#301b24');light.addColorStop(.5,this.rank>=7?'#c5a696':'#98636a');light.addColorStop(1,'#301b24');
        ctx.strokeStyle=light;ctx.lineWidth=1.25;
        for(const inset of this.rank>=7?[7,30]:[7]) {
          ctx.beginPath();ctx.ellipse(cx,top+depth+34,radius+inset,depth+inset,0,Math.PI*1.5-spread,Math.PI*1.5+spread);ctx.stroke();
        }
        if(this.rank>=7) {
          const reach=32+50*tension;
          for(const side of [-1,1]) {
            const x=cx+side*(this.rank===9&&side===1?110:88);
            ctx.beginPath();ctx.moveTo(x,48);ctx.lineTo(x+side*reach,48);ctx.lineTo(x+side*reach,54);ctx.stroke();
          }
        }
        ctx.restore();
      }
      const tickCenter = Math.floor(this.position*8);
      for (let i=tickCenter-46; i<=tickCenter+46; i++) {
        const angle = (i/8-this.position)*step;
        if (Math.abs(angle)>1.55) continue;
        const x=cx+radius*Math.sin(angle), y=top+34+depth*(1-Math.cos(angle));
        ctx.strokeStyle = i%8 === 0 ? '#75615e' : '#3d3033';
        ctx.beginPath(); ctx.moveTo(x,y+8); ctx.lineTo(x,y+(i%8 === 0?17:12)); ctx.stroke();
      }
      const center = Math.floor(this.position);
      for (let index=center-6; index<=center+6; index++) {
        const tier=this.labelAt(index), angle=(index-this.position)*step;
        if (!tier || Math.abs(angle)>1.48) continue;
        const x=cx+radius*Math.sin(angle), y=top+depth*(1-Math.cos(angle));
        if (x < -100 || x > width+100) continue;
        const focus=Math.exp(-Math.pow((index-this.position)*1.3,2));
        const edge=clamp(Math.min(x+36,width+36-x)/130,0,1);
        const alpha=(.35+.65*focus)*edge;
        ctx.save(); ctx.translate(x,y); ctx.globalAlpha=alpha;
        ctx.fillStyle=`rgb(${173+68*focus},${150+77*focus},${145+73*focus})`;
        ctx.font='600 20px "Segoe UI", sans-serif';
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.save(); ctx.scale(.6+.4*focus,.6+.4*focus);
        ctx.fillText(tier.label.toLocaleUpperCase('pt-BR'),0,0); ctx.restore();
        ctx.strokeStyle='#ad8580'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(0,18); ctx.lineTo(3,21); ctx.lineTo(0,24); ctx.lineTo(-3,21); ctx.closePath(); ctx.stroke();
        ctx.restore();
      }
      // Fixed focal point. Its light reacts; the geometry never shakes or scales.
      ctx.strokeStyle=`rgba(185,117,113,${energy+pulse*.25})`; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(cx,36); ctx.lineTo(cx,62); ctx.stroke();
      ctx.fillStyle='#c19a8f'; ctx.beginPath(); ctx.moveTo(cx,66);ctx.lineTo(cx-3,60);ctx.lineTo(cx+3,60);ctx.closePath();ctx.fill();
      const rail=ctx.createLinearGradient(cx-80,0,cx+80,0);
      rail.addColorStop(0,'rgba(162,103,102,0)'); rail.addColorStop(.5,`rgba(199,149,139,${.45+energy*.3+pulse*.2})`); rail.addColorStop(1,'rgba(162,103,102,0)');
      ctx.fillStyle=rail;ctx.fillRect(cx-80,133,160,1);
      for (const index of this.labels.keys()) {
        if (Math.abs(index-this.position)>18 && index!==this.plan?.target && !this.arrivals.has(index)) this.labels.delete(index);
      }
    }
  }
  const api = { create: options => new RollExperienceController(options), RollExperienceController, WEIGHTS, sample, randomSource, trajectory };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.NTCRollExperience = api;
})();
