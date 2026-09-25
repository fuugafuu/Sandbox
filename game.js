(() => {
'use strict';

const {
  Engine, Bodies, Body, Composite, Constraint, Query, Vector, Events
} = Matter;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
const ui = {
  healthBar: document.getElementById('healthBar'),
  nanoBar: document.getElementById('nanoBar'),
  energyBar: document.getElementById('energyBar'),
  healthText: document.getElementById('healthText'),
  nanoText: document.getElementById('nanoText'),
  energyText: document.getElementById('energyText'),
  suitState: document.getElementById('suitState'),
  weaponState: document.getElementById('weaponState'),
  pauseBtn: document.getElementById('pauseBtn'),
  slowBtn: document.getElementById('slowBtn'),
  toast: document.getElementById('toast')
};

const engine = Engine.create({ enableSleeping: true });
engine.gravity.y = 1.05;
engine.gravity.scale = 0.001;

const world = engine.world;
const W = 3200;
const FLOOR_Y = 900;
const input = { left:false, right:false, up:false, down:false, fire:false };
const camera = { x: 1000, y: 545, zoom: 1, targetZoom: 1 };
let viewW = innerWidth, viewH = innerHeight, dpr = Math.min(devicePixelRatio || 1, 2);
let paused = false, slowMo = false, now = 0, last = performance.now();
let dragConstraint = null, dragPointerId = null, panning = false, panStart = null;
let aimWorld = { x: 1220, y: 470 };
let toastTimer = 0;
let sceneSeed = 1;
const effects = [];
const debris = [];
const missiles = [];
const explosiveBodies = new Set();
const weaponNames = ['REPULSOR','UNIBEAM','NANO BLADE','NANO SHIELD','BATTERING RAM','CLUSTER CANNON','MICRO-MISSILES'];
let weaponMode = 0;

const COLORS = {
  bg:'#071018', grid:'#10202b', gridMajor:'#18303d', concrete:'#48545b',
  concreteEdge:'#75838a', crate:'#72523a', steel:'#51616b', steelEdge:'#91a5af',
  red:'#b73532', redDark:'#611b20', gold:'#d3a14d', goldDark:'#7a5728',
  cyan:'#9cf3ff', cyan2:'#43c8e8', skin:'#d2a17c', hair:'#211b19',
  cloth:'#151b21', cloth2:'#283039'
};

function clamp(v,a,b){ return Math.max(a, Math.min(b,v)); }
function lerp(a,b,t){ return a+(b-a)*t; }
function len(x,y){ return Math.hypot(x,y); }
function rand(a,b){
  sceneSeed = (sceneSeed * 1664525 + 1013904223) >>> 0;
  return a + (sceneSeed / 4294967296) * (b-a);
}
function smoothstep(a,b,x){
  const t = clamp((x-a)/(b-a),0,1);
  return t*t*(3-2*t);
}
function rotate(v,a){
  const c=Math.cos(a), s=Math.sin(a);
  return {x:v.x*c-v.y*s,y:v.x*s+v.y*c};
}
function localToWorld(body, p){
  const r=rotate(p, body.angle);
  return {x:body.position.x+r.x,y:body.position.y+r.y};
}
function worldToScreen(p){
  return {x:(p.x-camera.x)*camera.zoom+viewW/2,y:(p.y-camera.y)*camera.zoom+viewH/2};
}
function screenToWorld(x,y){
  return {x:(x-viewW/2)/camera.zoom+camera.x,y:(y-viewH/2)/camera.zoom+camera.y};
}
function toast(msg){
  ui.toast.textContent = msg;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>ui.toast.classList.remove('show'), 1200);
}

function resize(){
  viewW = innerWidth; viewH = innerHeight; dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.floor(viewW*dpr);
  canvas.height = Math.floor(viewH*dpr);
  canvas.style.width = viewW+'px';
  canvas.style.height = viewH+'px';
  camera.targetZoom = viewW < 760 ? 0.68 : viewW < 1100 ? 0.82 : 1;
}
addEventListener('resize', resize);
resize();

function tag(body, data){
  body.plugin = Object.assign(body.plugin || {}, data);
  return body;
}
function bodyRadius(body){
  const b=body.bounds;
  return Math.hypot(b.max.x-b.min.x,b.max.y-b.min.y)*0.52;
}
function finiteMass(body){ return Number.isFinite(body.mass) ? body.mass : 20; }

function createBreakableTile(x,y,w,h,hp=260){
  const b = Bodies.rectangle(x,y,w,h,{isStatic:true,friction:.9,restitution:.05});
  tag(b,{kind:'breakable',hp,maxHp:hp,material:'concrete'});
  Composite.add(world,b);
  return b;
}
function createBoundary(){
  const left = Bodies.rectangle(-40,500,80,1800,{isStatic:true});
  const right = Bodies.rectangle(W+40,500,80,1800,{isStatic:true});
  const ceiling = Bodies.rectangle(W/2,-500,W+300,100,{isStatic:true});
  tag(left,{kind:'boundary'});tag(right,{kind:'boundary'});tag(ceiling,{kind:'boundary'});
  Composite.add(world,[left,right,ceiling]);
}
function createEnvironment(){
  createBoundary();
  const tileW=160;
  for(let x=80;x<W;x+=tileW){
    createBreakableTile(x,FLOOR_Y,tileW-2,58,320);
    if(x>1800 && x<2450 && ((x/160)|0)%2===0){
      createBreakableTile(x,FLOOR_Y-145,110,230,240);
    }
  }
  for(let y=FLOOR_Y-85;y>FLOOR_Y-430;y-=85){
    createBreakableTile(1540,y,80,82,180);
  }
  const platform = Bodies.rectangle(760,700,440,24,{isStatic:true,friction:.8});
  tag(platform,{kind:'steel',hp:1200,maxHp:1200});
  Composite.add(world,platform);
}
function spawnCrate(x,y){
  const b=Bodies.rectangle(x,y,72,72,{density:.0017,friction:.7,restitution:.08,chamfer:{radius:4}});
  tag(b,{kind:'crate',hp:85,maxHp:85});
  Composite.add(world,b); return b;
}
function spawnConcrete(x,y){
  const b=Bodies.rectangle(x,y,110,62,{density:.0045,friction:.82,restitution:.02,chamfer:{radius:3}});
  tag(b,{kind:'concrete',hp:190,maxHp:190});
  Composite.add(world,b); return b;
}
function spawnSteel(x,y){
  const b=Bodies.rectangle(x,y,105,50,{density:.009,friction:.62,restitution:.08,chamfer:{radius:5}});
  tag(b,{kind:'steel',hp:700,maxHp:700});
  Composite.add(world,b); return b;
}
function spawnBarrel(x,y){
  const b=Bodies.rectangle(x,y,46,76,{density:.0022,friction:.55,restitution:.12,chamfer:{radius:10}});
  tag(b,{kind:'barrel',hp:55,maxHp:55});
  explosiveBodies.add(b);
  Composite.add(world,b); return b;
}

function ragdollPart(kind,name,body,maxHp=100){
  tag(body,{kind,partName:name,hp:maxHp,maxHp});
  return body;
}
function createDummy(x,y){
  const g=Body.nextGroup(true);
  const opts={collisionFilter:{group:g},friction:.75,frictionAir:.02,restitution:.05,density:.0015};
  const head=ragdollPart('dummy','head',Bodies.circle(x,y-90,22,{...opts,density:.0012}),65);
  const torso=ragdollPart('dummy','torso',Bodies.rectangle(x,y-35,48,72,{...opts,chamfer:{radius:9}}),110);
  const pelvis=ragdollPart('dummy','pelvis',Bodies.rectangle(x,y+15,42,30,{...opts,chamfer:{radius:7}}),90);
  const uaL=ragdollPart('dummy','arm',Bodies.rectangle(x-35,y-38,17,58,{...opts}),55);
  const uaR=ragdollPart('dummy','arm',Bodies.rectangle(x+35,y-38,17,58,{...opts}),55);
  const faL=ragdollPart('dummy','arm',Bodies.rectangle(x-38,y+8,15,52,{...opts}),50);
  const faR=ragdollPart('dummy','arm',Bodies.rectangle(x+38,y+8,15,52,{...opts}),50);
  const thL=ragdollPart('dummy','leg',Bodies.rectangle(x-14,y+60,20,68,{...opts}),75);
  const thR=ragdollPart('dummy','leg',Bodies.rectangle(x+14,y+60,20,68,{...opts}),75);
  const caL=ragdollPart('dummy','leg',Bodies.rectangle(x-14,y+116,18,62,{...opts}),70);
  const caR=ragdollPart('dummy','leg',Bodies.rectangle(x+14,y+116,18,62,{...opts}),70);
  const parts=[head,torso,pelvis,uaL,uaR,faL,faR,thL,thR,caL,caR];
  const c=(a,pa,b,pb,l=3,s=.62)=>Constraint.create({bodyA:a,pointA:pa,bodyB:b,pointB:pb,length:l,stiffness:s,damping:.09});
  const joints=[
    c(head,{x:0,y:18},torso,{x:0,y:-32},7,.66),
    c(torso,{x:0,y:32},pelvis,{x:0,y:-12},5,.72),
    c(torso,{x:-23,y:-24},uaL,{x:0,y:-25},4,.58),
    c(torso,{x:23,y:-24},uaR,{x:0,y:-25},4,.58),
    c(uaL,{x:0,y:25},faL,{x:0,y:-22},4,.52),
    c(uaR,{x:0,y:25},faR,{x:0,y:-22},4,.52),
    c(pelvis,{x:-13,y:12},thL,{x:0,y:-30},5,.65),
    c(pelvis,{x:13,y:12},thR,{x:0,y:-30},5,.65),
    c(thL,{x:0,y:30},caL,{x:0,y:-27},4,.58),
    c(thR,{x:0,y:30},caR,{x:0,y:-27},4,.58)
  ];
  Composite.add(world,[...parts,...joints]);
  return parts;
}

let tony;
function createTony(x,y){
  const group=Body.nextGroup(true);
  const opts={collisionFilter:{group},friction:.72,frictionAir:.018,restitution:.05,density:.0017};
  const actor={
    type:'tony', health:100, nano:100, energy:100, coverage:0, suitWanted:false,
    flight:false, alive:true, facing:1, fireCooldown:0, jumpCooldown:0, shieldBody:null,
    weaponMorph:0, armor:{}, armorMax:{}, bodyHp:{}, parts:{}, bodies:[], joints:[]
  };
  const add=(name,body,maxHp,armorMax)=>{
    tag(body,{kind:'tony',partName:name,actor});
    actor.parts[name]=body; actor.bodies.push(body); actor.bodyHp[name]=maxHp;
    actor.armor[name]=armorMax; actor.armorMax[name]=armorMax;
    return body;
  };
  const head=add('head',Bodies.circle(x,y-112,25,{...opts,density:.00125}),100,82);
  const torso=add('torso',Bodies.rectangle(x,y-48,56,86,{...opts,chamfer:{radius:13},density:.0022}),160,155);
  const pelvis=add('pelvis',Bodies.rectangle(x,y+10,48,34,{...opts,chamfer:{radius:9}}),120,115);
  const upperArmL=add('upperArmL',Bodies.rectangle(x-40,y-48,20,60,{...opts,chamfer:{radius:8}}),90,85);
  const upperArmR=add('upperArmR',Bodies.rectangle(x+40,y-48,20,60,{...opts,chamfer:{radius:8}}),90,85);
  const forearmL=add('forearmL',Bodies.rectangle(x-43,y+2,18,57,{...opts,chamfer:{radius:7}}),80,90);
  const forearmR=add('forearmR',Bodies.rectangle(x+43,y+2,18,57,{...opts,chamfer:{radius:7}}),80,90);
  const thighL=add('thighL',Bodies.rectangle(x-15,y+65,22,72,{...opts,chamfer:{radius:8}}),110,110);
  const thighR=add('thighR',Bodies.rectangle(x+15,y+65,22,72,{...opts,chamfer:{radius:8}}),110,110);
  const calfL=add('calfL',Bodies.rectangle(x-15,y+126,20,66,{...opts,chamfer:{radius:7}}),95,100);
  const calfR=add('calfR',Bodies.rectangle(x+15,y+126,20,66,{...opts,chamfer:{radius:7}}),95,100);
  const footL=add('footL',Bodies.rectangle(x-19,y+166,36,15,{...opts,chamfer:{radius:5}}),65,70);
  const footR=add('footR',Bodies.rectangle(x+19,y+166,36,15,{...opts,chamfer:{radius:5}}),65,70);

  const c=(a,pa,b,pb,l,s=.72)=>Constraint.create({bodyA:a,pointA:pa,bodyB:b,pointB:pb,length:l,stiffness:s,damping:.11});
  actor.joints=[
    c(head,{x:0,y:21},torso,{x:0,y:-38},5,.74),
    c(torso,{x:0,y:38},pelvis,{x:0,y:-14},4,.78),
    c(torso,{x:-27,y:-27},upperArmL,{x:0,y:-27},4,.68),
    c(torso,{x:27,y:-27},upperArmR,{x:0,y:-27},4,.68),
    c(upperArmL,{x:0,y:27},forearmL,{x:0,y:-25},4,.61),
    c(upperArmR,{x:0,y:27},forearmR,{x:0,y:-25},4,.61),
    c(pelvis,{x:-14,y:13},thighL,{x:0,y:-32},4,.72),
    c(pelvis,{x:14,y:13},thighR,{x:0,y:-32},4,.72),
    c(thighL,{x:0,y:32},calfL,{x:0,y:-29},4,.66),
    c(thighR,{x:0,y:32},calfR,{x:0,y:-29},4,.66),
    c(calfL,{x:0,y:29},footL,{x:8,y:-2},3,.68),
    c(calfR,{x:0,y:29},footR,{x:-8,y:-2},3,.68)
  ];
  Composite.add(world,[...actor.bodies,...actor.joints]);
  return actor;
}

const armorStart={
  torso:.02,pelvis:.10,upperArmL:.16,upperArmR:.18,forearmL:.25,forearmR:.28,
  thighL:.31,thighR:.34,calfL:.44,calfR:.47,footL:.53,footR:.55,head:.69
};
function armorPresence(name){
  const start=armorStart[name] ?? .2;
  return smoothstep(start,Math.min(1,start+.24),tony.coverage);
}

function clearDynamic(){
  const all=Composite.allBodies(world);
  for(const b of all){
    if(!b.isStatic) Composite.remove(world,b);
  }
  for(const c of Composite.allConstraints(world)){
    if(!c.bodyA || !c.bodyA.isStatic || !c.bodyB || !c.bodyB.isStatic) Composite.remove(world,c);
  }
  debris.length=0; missiles.length=0; explosiveBodies.clear();
}
function resetScene(){
  Composite.clear(world,false,true);
  effects.length=0; debris.length=0; missiles.length=0; explosiveBodies.clear();
  sceneSeed=1;
  createEnvironment();
  spawnCrate(1200,540); spawnCrate(1276,540);
  spawnConcrete(1350,600); spawnBarrel(1440,580);
  spawnSteel(1710,610);
  createDummy(1950,650);
  tony=createTony(980,610);
  camera.x=1000; camera.y=540;
  weaponMode=0; updateWeaponUI();
  toast('LAB RESET');
}
resetScene();

function recalcTonyHealth(){
  const weights={head:1.2,torso:1.8,pelvis:1.2,upperArmL:.5,upperArmR:.5,forearmL:.45,forearmR:.45,thighL:.7,thighR:.7,calfL:.6,calfR:.6,footL:.25,footR:.25};
  let cur=0,max=0;
  for(const [name,hp] of Object.entries(tony.bodyHp)){
    const w=weights[name]||1;
    max += (name==='torso'?160:name==='pelvis'?120:(name==='head'?100:(name.includes('thigh')?110:name.includes('calf')?95:name.includes('upperArm')?90:name.includes('forearm')?80:65)))*w;
    cur += Math.max(0,hp)*w;
  }
  tony.health=clamp(cur/max*100,0,100);
  tony.alive=tony.health>0;
}
function damageBody(body,amount,point,source='impact'){
  if(!body || amount<=0) return;
  const p=body.plugin||{};
  if(p.kind==='tony'){
    const name=p.partName;
    let rem=amount;
    const presence=armorPresence(name);
    if(tony.coverage>.05 && presence>.15 && tony.armor[name]>0){
      const absorb=Math.min(tony.armor[name],rem);
      tony.armor[name]-=absorb;
      rem-=absorb*.92;
      spark(point||body.position,Math.ceil(absorb/8),source==='energy');
      if(tony.armor[name]<=1) toast(name.toUpperCase()+' ARMOR BREACHED');
    }
    if(rem>0){
      tony.bodyHp[name]=Math.max(0,tony.bodyHp[name]-rem);
      recalcTonyHealth();
    }
  } else if(p.kind==='dummy'){
    p.hp=Math.max(0,(p.hp??70)-amount);
    if(p.hp<=0) body.frictionAir=.045;
  } else if(['crate','concrete','steel','breakable','barrel'].includes(p.kind)){
    p.hp=(p.hp??100)-amount;
    if(p.kind==='barrel' && p.hp<12){ explode(body.position,190,26,body); return; }
    if(p.hp<=0) fracture(body);
  }
}
function fracture(body){
  if(!body || !Composite.get(world,body.id,'body')) return;
  const p=body.plugin||{};
  if(p.kind==='barrel'){ explode(body.position,190,26,body); return; }
  const bx=body.bounds.max.x-body.bounds.min.x, by=body.bounds.max.y-body.bounds.min.y;
  const count=p.kind==='steel'?4:6;
  Composite.remove(world,body);
  for(let i=0;i<count;i++){
    const fw=Math.max(8,bx*(.18+rand(.02,.22))), fh=Math.max(8,by*(.18+rand(.03,.2)));
    const frag=Bodies.rectangle(body.position.x+rand(-bx*.25,bx*.25),body.position.y+rand(-by*.25,by*.25),fw,fh,{
      density:p.kind==='steel'?.007:.0028,friction:.65,restitution:.08,angle:rand(-1,1)
    });
    tag(frag,{kind:'debris',material:p.kind,ttl:5+rand(0,4)});
    Body.setVelocity(frag,{x:body.velocity.x+rand(-2.8,2.8),y:body.velocity.y+rand(-4,-.5)});
    Composite.add(world,frag); debris.push(frag);
  }
  dust(body.position,10);
}
function explode(pos,radius,power,sourceBody=null){
  effects.push({kind:'explosion',x:pos.x,y:pos.y,r:8,maxR:radius,life:.45,maxLife:.45});
  const bodies=Composite.allBodies(world).slice();
  for(const b of bodies){
    if(b===sourceBody) continue;
    const dx=b.position.x-pos.x,dy=b.position.y-pos.y,d=Math.hypot(dx,dy);
    if(d>radius||d<1) continue;
    const fall=1-d/radius;
    if(!b.isStatic){
      const f=power*fall*.00045*finiteMass(b);
      Body.applyForce(b,b.position,{x:dx/d*f,y:dy/d*f});
    }
    damageBody(b,power*fall*.8,pos,'explosion');
  }
  if(sourceBody){ explosiveBodies.delete(sourceBody); Composite.remove(world,sourceBody); }
  for(let i=0;i<34;i++){
    effects.push({kind:'particle',x:pos.x,y:pos.y,vx:rand(-8,8),vy:rand(-8,2),life:rand(.35,1),maxLife:1,size:rand(2,5),hot:true});
  }
}
function spark(pos,count=6,energy=false){
  if(!pos) return;
  for(let i=0;i<count;i++){
    effects.push({kind:'particle',x:pos.x,y:pos.y,vx:rand(-5,5),vy:rand(-5,2),life:rand(.15,.6),maxLife:.6,size:rand(1,3),hot:!energy,energy});
  }
}
function dust(pos,count=8){
  for(let i=0;i<count;i++) effects.push({kind:'dust',x:pos.x+rand(-10,10),y:pos.y+rand(-5,5),vx:rand(-1.5,1.5),vy:rand(-2,-.2),life:rand(.4,1),maxLife:1,size:rand(4,10)});
}

Events.on(engine,'collisionStart',ev=>{
  for(const pair of ev.pairs){
    const a=pair.bodyA,b=pair.bodyB;
    const missileA=a.plugin?.kind==='missile', missileB=b.plugin?.kind==='missile';
    if(missileA||missileB){
      const m=missileA?a:b, other=missileA?b:a;
      if(other.plugin?.kind!=='tony'){
        explode(m.position,115,22,m);
        const idx=missiles.findIndex(v=>v.body===m); if(idx>=0) missiles.splice(idx,1);
      }
      continue;
    }
    const rvx=a.velocity.x-b.velocity.x,rvy=a.velocity.y-b.velocity.y;
    const speed=Math.hypot(rvx,rvy);
    if(speed<5.4) continue;
    const mass=Math.min(28,Math.max(1,Math.min(finiteMass(a),finiteMass(b))));
    const dmg=Math.pow(speed-4.7,1.32)*(.65+mass*.045);
    const pt=pair.collision?.supports?.[0]||{x:(a.position.x+b.position.x)/2,y:(a.position.y+b.position.y)/2};
    damageBody(a,dmg,pt); damageBody(b,dmg,pt);
  }
});

function closestOnRay(start,end,width=18){
  const dx=end.x-start.x,dy=end.y-start.y,l2=dx*dx+dy*dy;
  let best=null,bestT=2;
  for(const b of Composite.allBodies(world)){
    if(b.plugin?.kind==='boundary'||b.plugin?.kind==='missile') continue;
    if(b.plugin?.kind==='tony') continue;
    const px=b.position.x-start.x,py=b.position.y-start.y;
    const t=clamp((px*dx+py*dy)/l2,0,1);
    const qx=start.x+dx*t,qy=start.y+dy*t;
    const d=Math.hypot(b.position.x-qx,b.position.y-qy);
    const rad=bodyRadius(b)*.65+width;
    if(d<rad && t<bestT){ bestT=t; best={body:b,point:{x:qx,y:qy},t}; }
  }
  return best;
}
function aimDirection(origin){
  let dx=aimWorld.x-origin.x,dy=aimWorld.y-origin.y;
  if(Math.hypot(dx,dy)<25){ dx=tony.facing*300;dy=0; }
  const l=Math.hypot(dx,dy)||1;
  return {x:dx/l,y:dy/l};
}
function fireBeam(origin,dir,range,width,damage,force,style='repulsor'){
  const end={x:origin.x+dir.x*range,y:origin.y+dir.y*range};
  const hit=closestOnRay(origin,end,width);
  const final=hit?hit.point:end;
  effects.push({kind:'beam',x1:origin.x,y1:origin.y,x2:final.x,y2:final.y,life:.11,maxLife:.11,width,style});
  if(hit){
    damageBody(hit.body,damage,hit.point,'energy');
    if(!hit.body.isStatic){
      Body.applyForce(hit.body,hit.point,{x:dir.x*force*finiteMass(hit.body),y:dir.y*force*finiteMass(hit.body)});
    }
    spark(hit.point,7,true);
  }
}
function shieldOn(){
  if(tony.shieldBody) Composite.remove(world,tony.shieldBody);
  const arm=tony.parts.forearmR;
  const dir=aimDirection(arm.position);
  const pos={x:arm.position.x+dir.x*52,y:arm.position.y+dir.y*52};
  const shield=Bodies.rectangle(pos.x,pos.y,18,130,{isStatic:true,isSensor:false,angle:Math.atan2(dir.y,dir.x),friction:.1,restitution:.16});
  tag(shield,{kind:'shield',owner:tony,ttl:1.0});
  tony.shieldBody=shield; Composite.add(world,shield);
  effects.push({kind:'shieldPulse',x:pos.x,y:pos.y,life:.25,maxLife:.25});
}
function doWeapon(dt){
  tony.fireCooldown=Math.max(0,tony.fireCooldown-dt);
  if(!input.fire || !tony.alive || tony.coverage<.78 || tony.fireCooldown>0) return;
  const hand=tony.parts.forearmR;
  const chest=tony.parts.torso;
  const origin=localToWorld(hand,{x:0,y:25});
  const dir=aimDirection(origin);
  tony.facing=dir.x>=0?1:-1;
  if(weaponMode===0 && tony.energy>=4){
    tony.energy-=4; tony.fireCooldown=.14;
    fireBeam(origin,dir,1000,11,18,.0018,'repulsor');
    Body.applyForce(hand,hand.position,{x:-dir.x*.0018*finiteMass(hand),y:-dir.y*.0018*finiteMass(hand)});
  } else if(weaponMode===1 && tony.energy>=24){
    tony.energy-=24; tony.fireCooldown=.85;
    fireBeam(chest.position,dir,1350,27,62,.0048,'unibeam');
    for(let i=0;i<18;i++) spark({x:chest.position.x+dir.x*rand(20,100),y:chest.position.y+dir.y*rand(20,100)},1,true);
  } else if(weaponMode===2 && tony.nano>=.4){
    tony.nano-=.4; tony.fireCooldown=.08; tony.weaponMorph=.35;
    const tip={x:origin.x+dir.x*120,y:origin.y+dir.y*120};
    effects.push({kind:'blade',x1:origin.x,y1:origin.y,x2:tip.x,y2:tip.y,life:.12,maxLife:.12});
    const hit=closestOnRay(origin,tip,14);
    if(hit){ damageBody(hit.body,34,hit.point,'blade'); if(!hit.body.isStatic) Body.applyForce(hit.body,hit.point,{x:dir.x*.001*finiteMass(hit.body),y:dir.y*.001*finiteMass(hit.body)}); }
  } else if(weaponMode===3 && tony.nano>=5){
    tony.nano-=5; tony.fireCooldown=.9; tony.weaponMorph=.7; shieldOn();
  } else if(weaponMode===4 && tony.nano>=4 && tony.energy>=5){
    tony.nano-=4; tony.energy-=5; tony.fireCooldown=.72; tony.weaponMorph=.65;
    const f=.006*finiteMass(chest);
    for(const b of tony.bodies) Body.applyForce(b,b.position,{x:dir.x*f*.15,y:dir.y*f*.15});
    const hit=closestOnRay(chest.position,{x:chest.position.x+dir.x*155,y:chest.position.y+dir.y*155},35);
    effects.push({kind:'ram',x:chest.position.x,y:chest.position.y,dir,life:.3,maxLife:.3});
    if(hit){ damageBody(hit.body,72,hit.point,'ram'); if(!hit.body.isStatic) Body.applyForce(hit.body,hit.point,{x:dir.x*.012*finiteMass(hit.body),y:dir.y*.012*finiteMass(hit.body)}); }
  } else if(weaponMode===5 && tony.nano>=6 && tony.energy>=18){
    tony.nano-=6; tony.energy-=18; tony.fireCooldown=1.05; tony.weaponMorph=.9;
    const points=[tony.parts.forearmL.position,tony.parts.forearmR.position,
      localToWorld(chest,{x:-35,y:-20}),localToWorld(chest,{x:35,y:-20})];
    for(const p of points) fireBeam(p,aimDirection(p),1150,9,18,.0012,'cluster');
  } else if(weaponMode===6 && tony.nano>=7 && tony.energy>=10){
    tony.nano-=7; tony.energy-=10; tony.fireCooldown=.95; tony.weaponMorph=.55;
    for(let i=-1;i<=1;i++) spawnMissile(localToWorld(chest,{x:i*16,y:-30}),dir,i*.08);
  }
}
function spawnMissile(pos,dir,spread){
  const a=Math.atan2(dir.y,dir.x)+spread;
  const d={x:Math.cos(a),y:Math.sin(a)};
  const b=Bodies.circle(pos.x+d.x*35,pos.y+d.y*35,7,{density:.001,frictionAir:.004,restitution:.1,collisionFilter:{group:0}});
  tag(b,{kind:'missile',owner:tony});
  Body.setVelocity(b,{x:d.x*16+tony.parts.torso.velocity.x,y:d.y*16+tony.parts.torso.velocity.y});
  Composite.add(world,b); missiles.push({body:b,life:2.8,dir:d});
}

function repairArmor(dt){
  if(tony.coverage<.92 || tony.nano<=0 || !tony.alive) return;
  let repaired=false;
  for(const name of Object.keys(tony.armor)){
    const presence=armorPresence(name);
    if(presence<.8) continue;
    const max=tony.armorMax[name], cur=tony.armor[name];
    if(cur<max-0.05 && tony.nano>0){
      const add=Math.min(max-cur,7.5*dt,tony.nano*1.8);
      tony.armor[name]+=add; tony.nano-=add*.055; repaired=true;
    }
  }
  if(repaired && Math.random()<.12) spark(tony.parts.torso.position,1,true);
}

function updateTony(dt){
  const torso=tony.parts.torso;
  if(tony.suitWanted) tony.coverage=Math.min(1,tony.coverage+dt*1.28);
  else tony.coverage=Math.max(0,tony.coverage-dt*1.38);

  if(tony.coverage>0.15 && tony.coverage<.98 && Math.random()<.4){
    const names=Object.keys(tony.parts), name=names[(Math.random()*names.length)|0];
    const b=tony.parts[name];
    effects.push({kind:'nano',x:b.position.x+rand(-18,18),y:b.position.y+rand(-22,22),vx:rand(-1,1),vy:rand(-1,1),life:.25,maxLife:.25,size:rand(1,3)});
  }

  if(input.left){ tony.facing=-1; Body.applyForce(torso,torso.position,{x:-.0016*finiteMass(torso),y:0}); }
  if(input.right){ tony.facing=1; Body.applyForce(torso,torso.position,{x:.0016*finiteMass(torso),y:0}); }

  tony.jumpCooldown=Math.max(0,tony.jumpCooldown-dt);
  if(input.up && !tony.flight && tony.jumpCooldown<=0){
    Body.applyForce(torso,torso.position,{x:0,y:-.0078*finiteMass(torso)});
    Body.applyForce(tony.parts.pelvis,tony.parts.pelvis.position,{x:0,y:-.0042*finiteMass(tony.parts.pelvis)});
    tony.jumpCooldown=.45;
  }

  if(tony.flight && tony.coverage>.75 && tony.energy>0){
    const lift=input.up?2.25:1.28;
    for(const b of tony.bodies){
      Body.applyForce(b,b.position,{x:0,y:-b.mass*engine.gravity.scale*engine.gravity.y*lift});
    }
    if(input.left||input.right){
      const x=(input.right?1:-1)*.0011*finiteMass(torso);
      Body.applyForce(torso,torso.position,{x,y:0});
    }
    tony.energy=Math.max(0,tony.energy-dt*(input.up?7:3));
    const desired=0,err=desired-torso.angle;
    Body.setAngularVelocity(torso,torso.angularVelocity+err*.018-torso.angularVelocity*.06);
    if(Math.random()<.8){
      for(const footName of ['footL','footR']){
        const foot=tony.parts[footName];
        effects.push({kind:'thruster',x:foot.position.x,y:foot.position.y+12,vx:rand(-.4,.4),vy:rand(3,7),life:.18,maxLife:.18,size:rand(2,5)});
      }
    }
  } else {
    tony.energy=Math.min(100,tony.energy+dt*13);
  }
  if(!input.fire) tony.energy=Math.min(100,tony.energy+dt*7);
  tony.weaponMorph=Math.max(0,tony.weaponMorph-dt*1.8);
  repairArmor(dt);
  doWeapon(dt);
}

function updateMissiles(dt){
  for(let i=missiles.length-1;i>=0;i--){
    const m=missiles[i]; m.life-=dt;
    if(!Composite.get(world,m.body.id,'body')){ missiles.splice(i,1); continue; }
    const v=m.body.velocity,l=Math.hypot(v.x,v.y)||1;
    Body.applyForce(m.body,m.body.position,{x:v.x/l*.00011*finiteMass(m.body),y:v.y/l*.00011*finiteMass(m.body)});
    effects.push({kind:'missileTrail',x:m.body.position.x-v.x*.7,y:m.body.position.y-v.y*.7,vx:rand(-.2,.2),vy:rand(-.2,.2),life:.25,maxLife:.25,size:rand(2,4)});
    if(m.life<=0){ explode(m.body.position,105,20,m.body); missiles.splice(i,1); }
  }
}
function updateShield(dt){
  if(!tony.shieldBody) return;
  const sh=tony.shieldBody, p=sh.plugin;
  p.ttl-=dt;
  if(p.ttl<=0){
    Composite.remove(world,sh); tony.shieldBody=null; return;
  }
  const arm=tony.parts.forearmR,dir=aimDirection(arm.position);
  Body.setPosition(sh,{x:arm.position.x+dir.x*54,y:arm.position.y+dir.y*54});
  Body.setAngle(sh,Math.atan2(dir.y,dir.x));
}
function updateDebris(dt){
  for(let i=debris.length-1;i>=0;i--){
    const b=debris[i]; b.plugin.ttl-=dt;
    if(b.plugin.ttl<=0 || b.position.y>1500){ Composite.remove(world,b); debris.splice(i,1); }
  }
}
function updateEffects(dt){
  for(let i=effects.length-1;i>=0;i--){
    const e=effects[i]; e.life-=dt;
    if(e.vx!=null){e.x+=e.vx*60*dt;e.y+=e.vy*60*dt;e.vy+=.08*60*dt;}
    if(e.life<=0) effects.splice(i,1);
  }
}
function updateCamera(dt){
  const p=tony.parts.torso.position;
  const dx=p.x-camera.x,dy=(p.y-20)-camera.y;
  const deadX=viewW/camera.zoom*.18,deadY=viewH/camera.zoom*.14;
  if(Math.abs(dx)>deadX) camera.x+=Math.sign(dx)*(Math.abs(dx)-deadX)*Math.min(1,dt*4);
  if(Math.abs(dy)>deadY) camera.y+=Math.sign(dy)*(Math.abs(dy)-deadY)*Math.min(1,dt*4);
  camera.x=clamp(camera.x,viewW/(2*camera.zoom)-30,W-viewW/(2*camera.zoom)+30);
  camera.y=clamp(camera.y,220,820);
  camera.zoom=lerp(camera.zoom,camera.targetZoom,1-Math.pow(.02,dt));
}

function update(dt){
  if(paused) return;
  const scaled=dt*(slowMo?.28:1);
  Engine.update(engine,Math.min(33,scaled*1000));
  updateTony(scaled);
  updateMissiles(scaled);
  updateShield(scaled);
  updateDebris(scaled);
  updateEffects(scaled);
  updateCamera(scaled);
}

function drawGrid(){
  ctx.fillStyle=COLORS.bg;
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.setTransform(dpr*camera.zoom,0,0,dpr*camera.zoom,dpr*(viewW/2-camera.x*camera.zoom),dpr*(viewH/2-camera.y*camera.zoom));
  const left=camera.x-viewW/(2*camera.zoom)-100,right=camera.x+viewW/(2*camera.zoom)+100;
  const top=camera.y-viewH/(2*camera.zoom)-100,bottom=camera.y+viewH/(2*camera.zoom)+100;
  ctx.lineWidth=1/camera.zoom;
  for(let x=Math.floor(left/40)*40;x<right;x+=40){
    ctx.strokeStyle=(x%200===0)?COLORS.gridMajor:COLORS.grid;
    ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();
  }
  for(let y=Math.floor(top/40)*40;y<bottom;y+=40){
    ctx.strokeStyle=(y%200===0)?COLORS.gridMajor:COLORS.grid;
    ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();
  }
  const grd=ctx.createLinearGradient(0,0,0,FLOOR_Y);
  grd.addColorStop(0,'rgba(54,113,139,.02)');grd.addColorStop(1,'rgba(54,113,139,.08)');
  ctx.fillStyle=grd;ctx.fillRect(left,top,right-left,bottom-top);
}

function pathBody(body,round=0){
  const v=body.vertices;
  ctx.beginPath();ctx.moveTo(v[0].x,v[0].y);
  for(let i=1;i<v.length;i++)ctx.lineTo(v[i].x,v[i].y);
  ctx.closePath();
}
function drawDamageCracks(body,ratio){
  if(ratio>.72) return;
  const n=Math.ceil((1-ratio)*4);
  ctx.save(); ctx.translate(body.position.x,body.position.y);ctx.rotate(body.angle);
  ctx.strokeStyle='rgba(17,25,29,.65)';ctx.lineWidth=1.2;
  for(let i=0;i<n;i++){
    const x=(i-1.5)*9;
    ctx.beginPath();ctx.moveTo(x,-12);ctx.lineTo(x+5,-2);ctx.lineTo(x-2,6);ctx.lineTo(x+7,14);ctx.stroke();
  }ctx.restore();
}
function drawWorldBody(body){
  const p=body.plugin||{},kind=p.kind;
  if(kind==='boundary'||kind==='tony'||kind==='dummy'||kind==='missile'||kind==='shield') return;
  pathBody(body);
  if(kind==='breakable'||kind==='concrete'){
    ctx.fillStyle=COLORS.concrete;ctx.fill();ctx.strokeStyle=COLORS.concreteEdge;ctx.lineWidth=1.2;ctx.stroke();
    const ratio=(p.hp??p.maxHp)/(p.maxHp||1);drawDamageCracks(body,ratio);
  } else if(kind==='crate'){
    ctx.fillStyle=COLORS.crate;ctx.fill();ctx.strokeStyle='#a78361';ctx.lineWidth=2;ctx.stroke();
    ctx.save();ctx.translate(body.position.x,body.position.y);ctx.rotate(body.angle);ctx.strokeStyle='rgba(28,18,12,.55)';
    ctx.beginPath();ctx.moveTo(-30,-30);ctx.lineTo(30,30);ctx.moveTo(30,-30);ctx.lineTo(-30,30);ctx.stroke();ctx.restore();
    drawDamageCracks(body,(p.hp??1)/(p.maxHp||1));
  } else if(kind==='steel'||kind==='debris'){
    ctx.fillStyle=kind==='debris'&&p.material==='concrete'?COLORS.concrete:COLORS.steel;ctx.fill();ctx.strokeStyle=COLORS.steelEdge;ctx.lineWidth=1.2;ctx.stroke();
  } else if(kind==='barrel'){
    ctx.fillStyle='#8b3430';ctx.fill();ctx.strokeStyle='#c06c61';ctx.lineWidth=1.5;ctx.stroke();
    ctx.save();ctx.translate(body.position.x,body.position.y);ctx.rotate(body.angle);ctx.fillStyle='#1c252b';ctx.fillRect(-23,-18,46,8);ctx.fillRect(-23,14,46,8);ctx.restore();
  }
}
function drawDummyPart(body){
  ctx.save();ctx.translate(body.position.x,body.position.y);ctx.rotate(body.angle);
  const name=body.plugin.partName;
  const dead=(body.plugin.hp||0)<=0;
  ctx.globalAlpha=dead?.55:1;
  ctx.fillStyle='#8ea085';ctx.strokeStyle='#bfd0b8';ctx.lineWidth=1.2;
  if(name==='head'){ctx.beginPath();ctx.arc(0,0,22,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#2a352b';ctx.fillRect(-8,-3,3,3);ctx.fillRect(5,-3,3,3);}
  else {const w=name==='torso'?48:name==='pelvis'?42:name==='arm'?17:19;const h=name==='torso'?72:name==='pelvis'?30:name==='arm'?54:65;ctx.beginPath();ctx.roundRect(-w/2,-h/2,w,h,5);ctx.fill();ctx.stroke();}
  ctx.restore();
}
function drawTonyBase(body,name){
  ctx.save();ctx.translate(body.position.x,body.position.y);ctx.rotate(body.angle);
  ctx.lineWidth=1.3;
  if(name==='head'){
    ctx.fillStyle=COLORS.skin;ctx.strokeStyle='#7a5943';ctx.beginPath();ctx.arc(0,0,25,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.fillStyle=COLORS.hair;ctx.beginPath();ctx.arc(0,-4,24,Math.PI,Math.PI*2);ctx.lineTo(20,-4);ctx.quadraticCurveTo(5,-24,-18,-12);ctx.fill();
    ctx.fillStyle='#3b2b24';ctx.fillRect(-11,8,22,3);ctx.fillRect(-6,11,12,4);
    ctx.fillStyle='#20262b';ctx.fillRect(-10,-3,4,2);ctx.fillRect(6,-3,4,2);
  } else {
    let w=20,h=58;
    if(name==='torso'){w=56;h=86;} else if(name==='pelvis'){w=48;h=34;}
    else if(name.includes('thigh')){w=22;h=72;} else if(name.includes('calf')){w=20;h=66;}
    else if(name.includes('foot')){w=36;h=15;} else if(name.includes('upperArm')){w=20;h=60;} else if(name.includes('forearm')){w=18;h=57;}
    ctx.fillStyle=name==='torso'?COLORS.cloth2:COLORS.cloth;ctx.strokeStyle='#3a4650';
    ctx.beginPath();ctx.roundRect(-w/2,-h/2,w,h,Math.min(8,w/3));ctx.fill();ctx.stroke();
    if(name==='torso'){
      ctx.strokeStyle='rgba(160,186,199,.25)';ctx.beginPath();ctx.moveTo(0,-42);ctx.lineTo(0,42);ctx.stroke();
      ctx.fillStyle=COLORS.cyan;ctx.shadowColor=COLORS.cyan;ctx.shadowBlur=14;ctx.beginPath();ctx.arc(0,-5,7,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    }
  }
  ctx.restore();
}
function armorGradient(x0,y0,x1,y1){
  const g=ctx.createLinearGradient(x0,y0,x1,y1);g.addColorStop(0,'#e1564a');g.addColorStop(.48,COLORS.red);g.addColorStop(1,COLORS.redDark);return g;
}
function drawArmor(body,name,presence){
  if(presence<=.01 || tony.armor[name]<=.2) return;
  const ratio=tony.armor[name]/tony.armorMax[name];
  ctx.save();ctx.translate(body.position.x,body.position.y);ctx.rotate(body.angle);ctx.globalAlpha=presence;
  ctx.lineWidth=1.15;ctx.strokeStyle='#ec7265';
  if(name==='head'){
    ctx.fillStyle=armorGradient(-20,-25,20,25);ctx.beginPath();ctx.arc(0,0,25,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.fillStyle=COLORS.gold;ctx.strokeStyle='#f1ca76';ctx.beginPath();ctx.moveTo(-16,-15);ctx.lineTo(16,-15);ctx.lineTo(19,3);ctx.lineTo(11,17);ctx.lineTo(-11,17);ctx.lineTo(-19,3);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.fillStyle=COLORS.cyan;ctx.shadowColor=COLORS.cyan;ctx.shadowBlur=9;ctx.fillRect(-12,-4,8,2.6);ctx.fillRect(4,-4,8,2.6);ctx.shadowBlur=0;
  } else {
    let w=20,h=58;
    if(name==='torso'){w=58;h=88;} else if(name==='pelvis'){w=50;h=36;}
    else if(name.includes('thigh')){w=24;h=74;} else if(name.includes('calf')){w=22;h=68;}
    else if(name.includes('foot')){w=38;h=17;} else if(name.includes('upperArm')){w=22;h=62;} else if(name.includes('forearm')){w=21;h=59;}
    ctx.fillStyle=armorGradient(-w/2,-h/2,w/2,h/2);
    ctx.beginPath();ctx.roundRect(-w/2,-h/2,w,h,Math.min(9,w/2));ctx.fill();ctx.stroke();
    ctx.strokeStyle='rgba(255,205,114,.55)';ctx.lineWidth=1;
    if(name==='torso'){
      ctx.fillStyle=COLORS.gold;ctx.beginPath();ctx.moveTo(-18,-38);ctx.lineTo(-5,-21);ctx.lineTo(-12,12);ctx.lineTo(-25,24);ctx.lineTo(-27,-23);ctx.closePath();ctx.fill();
      ctx.beginPath();ctx.moveTo(18,-38);ctx.lineTo(5,-21);ctx.lineTo(12,12);ctx.lineTo(25,24);ctx.lineTo(27,-23);ctx.closePath();ctx.fill();
      ctx.fillStyle=COLORS.cyan;ctx.shadowColor=COLORS.cyan;ctx.shadowBlur=18;ctx.beginPath();ctx.arc(0,-4,9,0,Math.PI*2);ctx.fill();ctx.fillStyle='#e6fdff';ctx.beginPath();ctx.arc(0,-4,4.5,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
      ctx.strokeStyle='rgba(255,230,170,.35)';ctx.beginPath();ctx.moveTo(-20,25);ctx.lineTo(-8,13);ctx.lineTo(0,20);ctx.lineTo(8,13);ctx.lineTo(20,25);ctx.stroke();
    } else if(name.includes('forearm')){
      ctx.fillStyle=COLORS.gold;ctx.beginPath();ctx.roundRect(-w*.33,h*.05,w*.66,h*.34,4);ctx.fill();
      if(name==='forearmR'&&tony.weaponMorph>.1){ctx.strokeStyle=COLORS.cyan;ctx.shadowColor=COLORS.cyan;ctx.shadowBlur=8;ctx.beginPath();ctx.arc(0,h*.37,5+tony.weaponMorph*5,0,Math.PI*2);ctx.stroke();ctx.shadowBlur=0;}
    } else if(name.includes('thigh')){
      ctx.fillStyle=COLORS.goldDark;ctx.beginPath();ctx.roundRect(-w*.28,-h*.25,w*.56,h*.38,3);ctx.fill();
    } else if(name.includes('foot')){
      ctx.fillStyle=COLORS.gold;ctx.fillRect(-w*.36,-h*.25,w*.72,h*.45);
    } else {
      ctx.strokeStyle='rgba(246,197,104,.45)';ctx.beginPath();ctx.moveTo(-w*.32,-h*.25);ctx.lineTo(w*.28,-h*.08);ctx.lineTo(-w*.2,h*.24);ctx.stroke();
    }
  }
  if(ratio<.72){
    ctx.strokeStyle='rgba(24,12,12,.82)';ctx.lineWidth=1.5;
    const n=Math.ceil((1-ratio)*4);
    for(let i=0;i<n;i++){ctx.beginPath();ctx.moveTo(-5+i*4,-12);ctx.lineTo(2+i*3,-3);ctx.lineTo(-3+i*4,8);ctx.stroke();}
  }
  ctx.restore();
}
function drawTony(){
  const order=['thighL','calfL','footL','upperArmL','forearmL','pelvis','torso','thighR','calfR','footR','upperArmR','forearmR','head'];
  for(const name of order) drawTonyBase(tony.parts[name],name);
  for(const name of order) drawArmor(tony.parts[name],name,armorPresence(name));
}
function drawMissile(body){
  ctx.save();ctx.translate(body.position.x,body.position.y);ctx.rotate(Math.atan2(body.velocity.y,body.velocity.x));
  ctx.fillStyle='#b9c7cc';ctx.beginPath();ctx.moveTo(10,0);ctx.lineTo(-7,-5);ctx.lineTo(-7,5);ctx.closePath();ctx.fill();
  ctx.fillStyle=COLORS.cyan;ctx.fillRect(-11,-2,5,4);ctx.restore();
}
function drawShield(body){
  ctx.save();ctx.translate(body.position.x,body.position.y);ctx.rotate(body.angle);
  const g=ctx.createLinearGradient(-10,0,10,0);g.addColorStop(0,'rgba(102,220,248,.08)');g.addColorStop(.5,'rgba(177,246,255,.42)');g.addColorStop(1,'rgba(102,220,248,.08)');
  ctx.fillStyle=g;ctx.strokeStyle='rgba(176,244,255,.85)';ctx.lineWidth=2;ctx.shadowColor=COLORS.cyan;ctx.shadowBlur=16;ctx.beginPath();ctx.roundRect(-9,-65,18,130,8);ctx.fill();ctx.stroke();ctx.restore();
}
function drawEffects(){
  ctx.save();ctx.globalCompositeOperation='lighter';
  for(const e of effects){
    const a=clamp(e.life/e.maxLife,0,1);
    if(e.kind==='beam'){
      ctx.globalAlpha=a;ctx.lineCap='round';
      ctx.strokeStyle=e.style==='unibeam'?'rgba(214,252,255,.95)':'rgba(117,231,255,.9)';
      ctx.shadowColor=COLORS.cyan;ctx.shadowBlur=e.style==='unibeam'?28:15;ctx.lineWidth=(e.style==='unibeam'?12:e.style==='cluster'?5:7)*a;
      ctx.beginPath();ctx.moveTo(e.x1,e.y1);ctx.lineTo(e.x2,e.y2);ctx.stroke();
      ctx.strokeStyle='white';ctx.lineWidth=Math.max(1,(e.style==='unibeam'?4:2)*a);ctx.beginPath();ctx.moveTo(e.x1,e.y1);ctx.lineTo(e.x2,e.y2);ctx.stroke();
    } else if(e.kind==='blade'){
      ctx.globalAlpha=a;ctx.strokeStyle='#b7f6ff';ctx.shadowColor=COLORS.cyan;ctx.shadowBlur=20;ctx.lineWidth=9*a;ctx.beginPath();ctx.moveTo(e.x1,e.y1);ctx.lineTo(e.x2,e.y2);ctx.stroke();ctx.strokeStyle='white';ctx.lineWidth=2;ctx.stroke();
    } else if(e.kind==='explosion'){
      ctx.globalAlpha=a;ctx.fillStyle='rgba(255,158,74,.16)';ctx.strokeStyle='rgba(255,220,139,.8)';ctx.lineWidth=4*a;ctx.beginPath();ctx.arc(e.x,e.y,lerp(e.r,e.maxR,1-a),0,Math.PI*2);ctx.fill();ctx.stroke();
    } else if(e.kind==='ram'){
      ctx.globalAlpha=a;ctx.strokeStyle='rgba(117,230,255,.8)';ctx.lineWidth=10*a;ctx.beginPath();ctx.moveTo(e.x,e.y);ctx.lineTo(e.x+e.dir.x*120,e.y+e.dir.y*120);ctx.stroke();
    } else if(e.kind==='shieldPulse'){
      ctx.globalAlpha=a;ctx.strokeStyle='rgba(140,239,255,.8)';ctx.lineWidth=3;ctx.beginPath();ctx.arc(e.x,e.y,(1-a)*55,0,Math.PI*2);ctx.stroke();
    } else {
      ctx.globalAlpha=a;
      if(e.kind==='dust'){ctx.fillStyle='rgba(151,159,161,.26)';ctx.shadowBlur=0;}
      else if(e.energy||e.kind==='nano'||e.kind==='thruster'||e.kind==='missileTrail'){ctx.fillStyle=e.kind==='thruster'?'#7edfff':'#a7f4ff';ctx.shadowColor=COLORS.cyan;ctx.shadowBlur=8;}
      else {ctx.fillStyle=e.hot?'#ffb562':'#ccc';ctx.shadowColor='#ff9d58';ctx.shadowBlur=5;}
      ctx.beginPath();ctx.arc(e.x,e.y,e.size||2,0,Math.PI*2);ctx.fill();
    }
  }
  ctx.restore();ctx.globalAlpha=1;ctx.shadowBlur=0;ctx.globalCompositeOperation='source-over';
}
function drawAim(){
  const s=worldToScreen(aimWorld);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.strokeStyle='rgba(125,226,249,.45)';ctx.lineWidth=1;
  ctx.beginPath();ctx.arc(s.x,s.y,10,0,Math.PI*2);ctx.moveTo(s.x-15,s.y);ctx.lineTo(s.x-5,s.y);ctx.moveTo(s.x+5,s.y);ctx.lineTo(s.x+15,s.y);ctx.moveTo(s.x,s.y-15);ctx.lineTo(s.x,s.y-5);ctx.moveTo(s.x,s.y+5);ctx.lineTo(s.x,s.y+15);ctx.stroke();
}
function draw(){
  drawGrid();
  const bodies=Composite.allBodies(world);
  for(const b of bodies) drawWorldBody(b);
  for(const b of bodies) if(b.plugin?.kind==='dummy') drawDummyPart(b);
  drawTony();
  for(const m of missiles) if(Composite.get(world,m.body.id,'body')) drawMissile(m.body);
  if(tony.shieldBody) drawShield(tony.shieldBody);
  drawEffects();
  drawAim();
  updateHUD();
}
function updateHUD(){
  const hp=Math.round(tony.health), nano=Math.round(tony.nano), power=Math.round(tony.energy);
  ui.healthText.textContent=hp;ui.nanoText.textContent=nano;ui.energyText.textContent=power;
  ui.healthBar.style.width=hp+'%';ui.nanoBar.style.width=nano+'%';ui.energyBar.style.width=power+'%';
  ui.suitState.textContent=tony.coverage<.05?'TONY / CIVILIAN':tony.coverage>.96?'MARK 50 / ONLINE':'NANOTECH / '+Math.round(tony.coverage*100)+'%';
  ui.weaponState.textContent=weaponNames[weaponMode];
}
function updateWeaponUI(){
  document.querySelectorAll('[data-weapon]').forEach((b,i)=>b.classList.toggle('active',i===weaponMode));
  if(ui.weaponState) ui.weaponState.textContent=weaponNames[weaponMode];
}
function setWeapon(i){
  weaponMode=(i+weaponNames.length)%weaponNames.length;updateWeaponUI();toast(weaponNames[weaponMode]);
}
function toggleSuit(){
  tony.suitWanted=!tony.suitWanted;
  if(!tony.suitWanted) tony.flight=false;
  toast(tony.suitWanted?'NANOTECH DEPLOY':'NANOTECH RETRACT');
}
function toggleFlight(){
  if(tony.coverage<.75){toast('SUIT REQUIRED');return;}
  tony.flight=!tony.flight;toast(tony.flight?'FLIGHT ASSIST ON':'FLIGHT ASSIST OFF');
}

function loop(ts){
  now=ts;const dt=clamp((ts-last)/1000,0,.033);last=ts;
  update(dt);draw();requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function pointerPos(ev){const r=canvas.getBoundingClientRect();return {x:ev.clientX-r.left,y:ev.clientY-r.top};}
canvas.addEventListener('pointerdown',ev=>{
  canvas.setPointerCapture(ev.pointerId);
  const sp=pointerPos(ev),wp=screenToWorld(sp.x,sp.y);
  aimWorld=wp;
  if(ev.button===2){panning=true;panStart={sx:sp.x,sy:sp.y,cx:camera.x,cy:camera.y};return;}
  const hits=Query.point(Composite.allBodies(world),wp).filter(b=>!b.isStatic&&b.plugin?.kind!=='missile');
  const target=hits[hits.length-1];
  if(target){
    const local=rotate({x:wp.x-target.position.x,y:wp.y-target.position.y},-target.angle);
    dragConstraint=Constraint.create({pointA:{x:wp.x,y:wp.y},bodyB:target,pointB:local,length:0,stiffness:.22,damping:.16});
    Composite.add(world,dragConstraint);dragPointerId=ev.pointerId;
  } else if(ev.pointerType==='mouse'){
    input.fire=true;
  }
});
canvas.addEventListener('pointermove',ev=>{
  const sp=pointerPos(ev),wp=screenToWorld(sp.x,sp.y);
  aimWorld=wp;
  if(dragConstraint&&dragPointerId===ev.pointerId){dragConstraint.pointA.x=wp.x;dragConstraint.pointA.y=wp.y;}
  if(panning&&panStart){
    camera.x=panStart.cx-(sp.x-panStart.sx)/camera.zoom;
    camera.y=panStart.cy-(sp.y-panStart.sy)/camera.zoom;
  }
});
function endPointer(ev){
  input.fire=false;
  if(dragConstraint&&dragPointerId===ev.pointerId){Composite.remove(world,dragConstraint);dragConstraint=null;dragPointerId=null;}
  panning=false;panStart=null;
}
canvas.addEventListener('pointerup',endPointer);canvas.addEventListener('pointercancel',endPointer);
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('wheel',ev=>{
  ev.preventDefault();
  camera.targetZoom=clamp(camera.targetZoom*Math.exp(-ev.deltaY*.001),.5,1.5);
},{passive:false});

addEventListener('keydown',e=>{
  if(e.repeat && ['KeyE','KeyF','KeyQ','KeyP','KeyT','KeyR'].includes(e.code)) return;
  if(e.code==='KeyA')input.left=true;
  if(e.code==='KeyD')input.right=true;
  if(e.code==='KeyW')input.up=true;
  if(e.code==='KeyS')input.down=true;
  if(e.code==='Space'){input.fire=true;e.preventDefault();}
  if(e.code==='KeyE')toggleSuit();
  if(e.code==='KeyF')toggleFlight();
  if(e.code==='KeyQ')setWeapon(weaponMode+1);
  if(e.code==='KeyP'){paused=!paused;toast(paused?'PAUSED':'RESUME');}
  if(e.code==='KeyT'){slowMo=!slowMo;toast(slowMo?'SLOW-MO':'NORMAL TIME');}
  if(e.code==='KeyR')resetScene();
  if(/^Digit[1-7]$/.test(e.code))setWeapon(Number(e.code.slice(-1))-1);
});
addEventListener('keyup',e=>{
  if(e.code==='KeyA')input.left=false;
  if(e.code==='KeyD')input.right=false;
  if(e.code==='KeyW')input.up=false;
  if(e.code==='KeyS')input.down=false;
  if(e.code==='Space')input.fire=false;
});

document.querySelectorAll('[data-spawn]').forEach(btn=>btn.addEventListener('click',()=>{
  const p={x:camera.x+rand(-60,60),y:camera.y-120};
  const k=btn.dataset.spawn;
  if(k==='dummy')createDummy(p.x,p.y);
  if(k==='crate')spawnCrate(p.x,p.y);
  if(k==='concrete')spawnConcrete(p.x,p.y);
  if(k==='barrel')spawnBarrel(p.x,p.y);
  if(k==='steel')spawnSteel(p.x,p.y);
  toast(k.toUpperCase()+' SPAWNED');
}));
document.getElementById('resetBtn').addEventListener('click',resetScene);
ui.pauseBtn.addEventListener('click',()=>{paused=!paused;toast(paused?'PAUSED':'RESUME');});
ui.slowBtn.addEventListener('click',()=>{slowMo=!slowMo;toast(slowMo?'SLOW-MO':'NORMAL TIME');});
document.querySelectorAll('[data-weapon]').forEach(btn=>btn.addEventListener('click',()=>setWeapon(Number(btn.dataset.weapon))));
document.getElementById('mobileSuit').addEventListener('click',toggleSuit);
document.getElementById('mobileFlight').addEventListener('click',toggleFlight);
document.getElementById('mobileWeapon').addEventListener('click',()=>setWeapon(weaponMode+1));

function holdButton(el,key){
  const on=e=>{e.preventDefault();input[key]=true;};
  const off=e=>{e.preventDefault();input[key]=false;};
  el.addEventListener('pointerdown',on);el.addEventListener('pointerup',off);el.addEventListener('pointercancel',off);el.addEventListener('pointerleave',off);
}
document.querySelectorAll('[data-hold]').forEach(el=>holdButton(el,el.dataset.hold));
const fireBtn=document.getElementById('mobileFire');
fireBtn.addEventListener('pointerdown',e=>{e.preventDefault();input.fire=true;});
['pointerup','pointercancel','pointerleave'].forEach(n=>fireBtn.addEventListener(n,e=>{e.preventDefault();input.fire=false;}));

})();
