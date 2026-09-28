'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { create, trajectory, sample, randomSource } = require('../src/rng-roll-experience.js');
const tiers = ['basic','epic','unique','legendary','mythic','exalted','glorious','transcendent','dimensional','ntc'].map(id => ({id,label:id}));
const state = (roll, tier='basic', autoRollActive=false) => ({tiers,totalRolls:roll,autoRollActive,latestResult:{roll,title:{tier}}});
function fixture() {
  let time=0, sequence=0, peakFrames=0;
  const callbacks=new Map(), results=[], reveals=[], cycleCompletions=[];
  const context=new Proxy({}, {get:(_,name)=>name==='createLinearGradient'?()=>({addColorStop(){}}):()=>{}});
  const root={dataset:{},clientWidth:900,querySelector:selector=>selector==='canvas'?{clientHeight:286,getContext:()=>context}:{textContent:''}};
  let c;
  c=create({root,onResult:r=>results.push(r),onRevealReady:()=>{reveals.push(c.position);c.setOccluded(true);},onCycleComplete:()=>cycleCompletions.push(time),clock:{now:()=>time,request:callback=>{callbacks.set(++sequence,callback);peakFrames=Math.max(peakFrames,callbacks.size);return sequence;},cancel:id=>callbacks.delete(id)}});
  function step(ms=16) {time+=ms;const pending=[...callbacks.values()];callbacks.clear();pending.forEach(fn=>fn(time));}
  function run(ms) {for(let elapsed=0;elapsed<ms;elapsed+=16)step(Math.min(16,ms-elapsed));}
  return {c,root,results,reveals,cycleCompletions,callbacks,step,run,get peakFrames(){return peakFrames;}};
}
test('trajectory arrives exactly, preserves entry velocity and decelerates without reversing',()=>{
  for(const velocity of [0,2.4,7]) {
    let previous=0;
    for(let elapsed=0;elapsed<=3400;elapsed+=10) {
      const p=trajectory(0,8,velocity,3400,elapsed);
      assert.ok(p.position>=previous-1e-10);assert.ok(p.velocity>=-1e-10);previous=p.position;
    }
    assert.equal(trajectory(0,8,velocity,3400,0).velocity,velocity);
    assert.deepEqual(trajectory(0,8,velocity,3400,3400),{position:8,velocity:0});
  }
  assert.ok(trajectory(0,8,0,3400,3000).velocity < trajectory(0,8,0,3400,2000).velocity);
});
test('manual motion retains identities, lands on real tier and releases its frame loop',()=>{
  const f=fixture(),{c}=f;c.update(state(1));c.beginRequest();assert.equal(c.phase,'starting');
  const visible=new Map(c.labels);c.update(state(2,'unique'));
  for(const [index,tier] of visible)assert.equal(c.labels.get(index),tier);
  const end=c.plan.target;f.run(1000);assert.ok(c.position>0&&c.position<end);assert.equal(f.results.at(-1).roll,1);
  f.run(4000);assert.equal(c.position,end);assert.equal(c.labels.get(end).id,'unique');
  assert.equal(f.results.at(-1).roll,2);assert.equal(f.callbacks.size,0);assert.equal(f.peakFrames,1);
});
test('manual presentation completes only after the existing settle pulse; reveal stays owned by its modal',async()=>{
  const f=fixture(),{c}=f;c.update(state(1));c.update(state(2,'basic'));
  const travel=c.plan.duration;f.run(travel);
  assert.equal(f.results.at(-1).roll,2);
  assert.equal(f.cycleCompletions.length,0,'result arrival is not the end of its settle pulse');
  f.run(240);
  await Promise.resolve();
  assert.equal(f.cycleCompletions.length,1);

  c.update(state(3,'unique'),{reveal:true,discoveryResult:state(3,'unique').latestResult});
  f.run(4000);
  assert.equal(f.reveals.length,1);
  assert.equal(f.cycleCompletions.length,1,'a discovery remains locked until the reveal is dismissed');
});
test('auto snapshots neither restart motion nor rewrite visible labels; long runs stay bounded',()=>{
  const f=fixture(),{c}=f;c.update(state(1,'basic',true));
  for(let roll=2;roll<1202;roll++) {
    f.run(1000);
    const before=c.position, velocity=c.velocity;
    const visible=[...c.labels].filter(([index])=>Math.abs(index-c.position)<c.hiddenLead()-1);
    c.update(state(roll,roll%3?'basic':'epic',true));
    assert.equal(c.position,before);assert.equal(c.velocity,velocity);
    for(const [index,tier] of visible)assert.equal(c.labels.get(index),tier);
    c.update(state(roll,roll%3?'basic':'epic',true));assert.equal(c.position,before);
    assert.ok(c.labels.size<55);assert.ok(c.arrivals.size<=8);
  }
  assert.ok(f.results.length>1100);assert.equal(f.peakFrames,1);assert.ok(c.velocity>2);
  c.dispose();assert.equal(f.callbacks.size,0);
});
test('manual interruption, starting auto and pausing it preserve forward motion',()=>{
  const f=fixture(),{c}=f;c.update(state(1));c.update(state(2));f.run(600);
  let previous=c.position;c.update(state(2,'basic',true));assert.equal(c.position,previous);
  f.run(1600);c.update(state(3,'epic',true));f.run(400);
  previous=c.position;c.update(state(3,'epic',false));assert.equal(c.position,previous);
  for(let i=0;i<200;i++){f.step();assert.ok(c.position>=previous-1e-9);previous=c.position;}
  assert.equal(f.results.at(-1).title.tier,'epic');assert.equal(f.callbacks.size,0);
  for(let roll=4;roll<100;roll++){c.update(state(roll,tiers[roll%10].id));f.run(350);}
  previous=c.position;
  for(let i=0;i<400;i++){f.step();assert.ok(c.position>=previous-1e-9);previous=c.position;}
  assert.equal(f.results.at(-1).roll,99);assert.equal(f.peakFrames,1);
});
test('bursts bound ordinary presentations without dropping discovery handoff',()=>{
  const f=fixture(),{c}=f;c.update(state(1,'basic',true));f.run(600);
  for(let i=2;i<200;i++)c.update(state(i,'epic',true));
  assert.ok(c.arrivals.size<=8);assert.ok(c.labels.size<55);
  const discovery=state(200,'ntc').latestResult;
  c.update(state(202,'basic',true),{reveal:true,discoveryResult:discovery});
  const target=c.plan.target;
  c.update(state(203,'basic',true),{reveal:true,discoveryResult:discovery});
  assert.equal(c.plan.result,discovery);assert.equal(c.plan.target,target);
  f.run(6000);assert.equal(f.reveals.length,1);assert.equal(f.results.at(-1).roll,200);assert.equal(f.callbacks.size,0);
  c.update(state(204,'epic',true));c.setOccluded(false);
  assert.equal(f.results.at(-1).roll,204);assert.equal(f.callbacks.size,1);
});
test('hidden views, reduced/off preferences and disposal cancel expensive motion',()=>{
  const f=fixture(),{c}=f;c.update(state(1));c.update(state(2,'mythic'),{reveal:true});
  f.run(500);c.setVisible(false);assert.equal(f.reveals.length,1);assert.equal(f.callbacks.size,0);
  c.update(state(3,'basic',true));assert.equal(f.callbacks.size,0);c.setOccluded(false);c.setVisible(true);
  c.setMotion('reduced');f.run(300);assert.equal(f.callbacks.size,0);
  c.update(state(4,'epic',true));assert.equal(f.results.at(-1).roll,4);assert.equal(c.plan,null);f.run(300);assert.equal(f.callbacks.size,0);
  c.setMotion('off');c.update(state(5,'ntc',true));assert.equal(f.results.at(-1).roll,5);assert.equal(f.callbacks.size,0);
  c.setMotion('full');assert.equal(f.callbacks.size,1);c.dispose();assert.equal(f.callbacks.size,0);
  c.update(state(6));assert.equal(f.callbacks.size,0);
});
test('decorative distribution is independent of real odds and keeps extremes exceptional',()=>{
  const random=randomSource(12345),counts=Object.fromEntries(tiers.map(t=>[t.id,0]));
  for(let i=0;i<100000;i++)counts[sample(tiers,random).id]++;
  assert.ok(counts.basic>60000&&counts.basic<64000);assert.ok(counts.epic>23500&&counts.epic<26500);
  assert.ok(counts.unique>8000&&counts.unique<10000);assert.ok(counts.legendary>2500&&counts.legendary<3500);
  assert.ok(counts.mythic>counts.exalted&&counts.exalted>counts.glorious);
  assert.ok(counts.transcendent<30&&counts.dimensional<10&&counts.ntc<4);
});
