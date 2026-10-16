/* Zrno a žár — ukázka. Vladislav Zachariev, Whyte Lynx. */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;

gsap.registerPlugin(ScrollTrigger);

/* ---------- smooth scroll ---------- */
const lenis = new Lenis({ duration: reduce ? 0 : 1.15, smoothWheel: !reduce });
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add(t => lenis.raf(t * 1000));
gsap.ticker.lagSmoothing(0);
$$('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
  const id = a.getAttribute('href');
  if (id.length < 2) return;
  const el = $(id); if (!el) return;
  e.preventDefault();
  lenis.scrollTo(el, { offset: id === '#top' ? 0 : -10 });
}));
window.__go = y => lenis.scrollTo(y, { immediate: true, force: true });

/* ---------- toast ---------- */
const toastEl = $('#toast'); let toastT;
const toast = msg => {
  toastEl.textContent = msg; toastEl.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 3400);
};

/* ---------- nav ---------- */
const nav = $('#nav');
const setNav = () => { const h = document.getElementById('hero'); nav.classList.toggle('is-solid', scrollY > h.offsetHeight - innerHeight + 20); };
addEventListener('scroll', setNav, { passive: true }); setNav();

/* ---------- hero title: words ---------- */
const title = $('.hero__title');
(function split(node) {
  [...node.childNodes].forEach(n => {
    if (n.nodeType === 3) {
      const frag = document.createDocumentFragment();
      n.textContent.split(/(\s+)/).forEach(part => {
        if (!part) return;
        if (/^\s+$/.test(part)) { frag.append(part); return; }
        const s = document.createElement('span'); s.className = 'w'; s.textContent = part; frag.append(s);
      });
      n.replaceWith(frag);
    } else if (n.nodeType === 1 && n.tagName !== 'BR') split(n);
  });
})(title);
$$('.w', title).forEach((w, i) => { w.style.transitionDelay = (0.15 + i * 0.07) + 's'; });

/* =========================================================
   HERO — šálek: pára, foukání myší, vlnky, ponor do kávy
   ========================================================= */
// dvě fotky: na šířku a na výšku (mobil); střed kávy v uv (y nahoru), poloměr v jednotkách výšky obrázku
const SRC = {
  land: { src: () => innerWidth < 700 ? 'img/salek-m.webp' : 'img/salek.webp', w: 2400, h: 1340, cup: { x: 0.6152, y: 0.5035, r: 0.166 } },
  port: { src: () => 'img/salek-v.webp', w: 1080, h: 1935, cup: { x: 0.5043, y: 0.7504, r: 0.1051 } }
};
const isPortrait = () => innerWidth / innerHeight < 0.9;
let srcKey = isPortrait() ? 'port' : 'land';
let IMG = { w: SRC[srcKey].w, h: SRC[srcKey].h }, CUP = SRC[srcKey].cup;
const hero = $('#hero'), stage = $('.hero__stage'), canvas = $('#gl');
const heroCopy = $('#heroCopy'), heroDark = $('#heroDark');
const state = { heroP: 0, gl: false, ripples: 0 };

// screen uv -> image uv mapping (cover s volitelným posunem šálku)
let map = { ax: 0, ay: 0, bx: 1, by: 1 }, cupScreen = { x: 0, y: 0, r: 0 };
function computeMap() {
  const vw = stage.clientWidth, vh = stage.clientHeight;
  const portrait = srcKey === 'port';
  const sf = portrait ? { x: 0.5, y: 0.75 } : { x: vw < 1100 ? 0.66 : 0.64, y: 0.5 };   // kde má šálek být na obrazovce (y nahoru)
  const fx = CUP.x, fy = CUP.y;
  let k = Math.max(vw / IMG.w, vh / IMG.h);
  k = Math.max(k,
    sf.x * vw / (fx * IMG.w), (1 - sf.x) * vw / ((1 - fx) * IMG.w),
    sf.y * vh / (fy * IMG.h), (1 - sf.y) * vh / ((1 - fy) * IMG.h));
  // image uv = a + screen uv * b
  map.bx = vw / (k * IMG.w); map.by = vh / (k * IMG.h);
  map.ax = fx - sf.x * map.bx; map.ay = fy - sf.y * map.by;
  cupScreen = { x: sf.x * vw, y: (1 - sf.y) * vh, r: CUP.r * IMG.h * k };
}

const VERT = `attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}`;
const FRAG = `
precision highp float;
varying vec2 v;
uniform sampler2D uTex;
uniform vec4 uMap;      // ax ay bx by
uniform vec2 uRes, uM, uWind;
uniform float uT, uS, uAsp, uMOn;
uniform vec3 uCup;      // x y r
uniform vec4 uRip[6];   // x y t0 strength
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}
void main(){
  vec2 uv0=uMap.xy+v*uMap.zw;
  // ponor: přiblížení ke středu kávy
  float z=1.+pow(uS,2.4)*8.;
  vec2 uv=uCup.xy+(uv0-uCup.xy)/z;
  vec2 asp=vec2(uAsp,1.);
  vec2 dc=(uv-uCup.xy)*asp;               // v jednotkách výšky obrázku
  float dist=length(dc);
  float inCup=1.-smoothstep(uCup.z*.93,uCup.z*1.0,dist);

  // vlnky po ťuknutí
  vec2 off=vec2(0.); float spec=0.;
  for(int i=0;i<6;i++){
    vec4 r=uRip[i];
    float age=uT-r.z;
    if(age<0.||age>4.5||r.w<=0.) continue;
    vec2 d=(uv-r.xy)*asp; float L=length(d)+1e-4;
    float R=age*.085;
    float x=L-R;
    float env=exp(-age*1.05)*exp(-x*x*900.)*r.w;
    float w=sin(x*230.)*env;
    off+=d/L*w*.0062;
    spec+=max(0.,cos(x*230.-1.2))*env;
  }
  // jemné dýchání hladiny
  float idle=fbm(dc*38.+vec2(uT*.25,-uT*.18));
  off+=(vec2(idle)-.5)*.0016*inCup;
  vec2 suv=uv+off*inCup;
  vec3 col=texture2D(uTex,clamp(suv,0.,1.)).rgb;

  // odlesky na kávě (světlo zprava nahoře)
  col+=vec3(1.,.93,.82)*pow(spec,3.)*.85*inCup;
  float sheen=smoothstep(.25,.0,length(dc-vec2(.06,.05)))*.05*inCup*(1.-uS);
  col+=sheen;

  // pára — nad šálkem, unášená doprava nahoru, foukání myší ji rozhání
  vec2 sp=(uv0-uCup.xy)*asp;                // pára neplave se zoomem stejně: drží se obrazovky
  sp/=mix(1.,2.6,uS);
  float t=uT*.11;
  vec2 drift=vec2(.035,.06)*uT*.35+uWind*.9;
  vec2 q=sp*6.-drift*6.;
  vec2 warp=vec2(fbm(q+vec2(t*2.,0.)),fbm(q+vec2(5.2,1.3-t*2.)));
  float st=fbm(q*1.15+warp*2.6+vec2(0.,-t*3.));
  float rr=length(sp-vec2(.02,.035)-uWind*.35);
  float mask=smoothstep(uCup.z*2.15,uCup.z*.3,rr);
  float wisp=smoothstep(.48,.86,st)*mask;
  // díra, kam foukáme
  vec2 mp=((uMap.xy+uM*uMap.zw)-uCup.xy)*asp; mp/=mix(1.,2.6,uS);
  float hole=smoothstep(.0,.13,length(sp-mp));
  wisp*=mix(1.,hole,uMOn);
  wisp*=(1.-smoothstep(.55,.95,uS));
  // stín páry vlevo dole (světlo zprava)
  vec2 sp2=sp+vec2(.05,-.02);
  vec2 q2=sp2*6.-drift*6.;
  float st2=fbm(q2*1.15+vec2(fbm(q2+vec2(t*2.,0.)),fbm(q2+vec2(5.2,1.3-t*2.)))*2.6+vec2(0.,-t*3.));
  float shad=smoothstep(.5,.9,st2)*smoothstep(uCup.z*2.15,uCup.z*.3,length(sp2-vec2(.02,.035)))*(1.-inCup);
  col*=1.-shad*.07*(1.-uS);
  col=mix(col,vec3(1.,.985,.96),wisp*.42);

  // zrno a vinětace
  float g=h(v*uRes+fract(uT)*91.)-.5;
  col+=g*.028;
  vec2 vv=v-.5; col*=1.-dot(vv,vv)*mix(.32,.9,uS);
  gl_FragColor=vec4(col,1.);
}`;

let gl, prog, U = {}, tex, ripples = [], ripIdx = 0, mouse = { x: .5, y: .5, on: 0, tOn: 0 }, wind = { x: 0, y: 0 }, lastTap = 0;
function initGL() {
  try {
    gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
  } catch (e) { gl = null; }
  if (!gl) return false;
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(o)); return null; } return o; };
  const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return false;
  prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
  gl.useProgram(prog);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  ['uTex', 'uMap', 'uRes', 'uM', 'uWind', 'uT', 'uS', 'uAsp', 'uMOn', 'uCup', 'uRip'].forEach(n => U[n] = gl.getUniformLocation(prog, n));
  for (let i = 0; i < 6; i++) ripples.push([0, 0, -99, 0]);
  return true;
}
function loadTex(src) {
  return new Promise((res, rej) => {
    const im = new Image(); im.decoding = 'async';
    im.onload = () => {
      tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, im);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      res();
    };
    im.onerror = rej; im.src = src;
  });
}
function resize() {
  computeMap();
  if (!gl) return;
  const dpr = Math.min(devicePixelRatio || 1, innerWidth < 700 ? 2 : 1.5);
  canvas.width = Math.round(stage.clientWidth * dpr); canvas.height = Math.round(stage.clientHeight * dpr);
  gl.viewport(0, 0, canvas.width, canvas.height);
  placeBeans();
}
function addRipple(ux, uy, s = 1) {   // image uv
  ripples[ripIdx] = [ux, uy, performance.now() / 1000 - t0, s];
  ripIdx = (ripIdx + 1) % 6; state.ripples++;
}
// screen px -> image uv (bez zoomu; pro ťuknutí na začátku)
function screenToImg(px, py) {
  const r = stage.getBoundingClientRect();
  const sx = (px - r.left) / r.width, sy = 1 - (py - r.top) / r.height;
  const z = 1 + Math.pow(state.heroP, 2.4) * 8;
  let ux = map.ax + sx * map.bx, uy = map.ay + sy * map.by;
  ux = CUP.x + (ux - CUP.x) / z; uy = CUP.y + (uy - CUP.y) / z;
  return [ux, uy];
}
function inCoffee(ux, uy) {
  const dx = (ux - CUP.x) * IMG.w / IMG.h, dy = uy - CUP.y;
  return Math.hypot(dx, dy) < CUP.r * 0.92;
}
const t0 = performance.now() / 1000;
let heroVisible = true;
function frame() {
  if (gl && heroVisible) {
    const t = performance.now() / 1000 - t0;
    mouse.on = lerp(mouse.on, mouse.tOn, 0.06);
    wind.x *= 0.965; wind.y *= 0.965;
    gl.uniform1i(U.uTex, 0);
    gl.uniform4f(U.uMap, map.ax, map.ay, map.bx, map.by);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform2f(U.uM, mouse.x, mouse.y);
    gl.uniform2f(U.uWind, wind.x, wind.y);
    gl.uniform1f(U.uT, t);
    gl.uniform1f(U.uS, state.heroP);
    gl.uniform1f(U.uAsp, IMG.w / IMG.h);
    gl.uniform1f(U.uMOn, mouse.on);
    gl.uniform3f(U.uCup, CUP.x, CUP.y, CUP.r);
    gl.uniform4fv(U.uRip, new Float32Array(ripples.flat()));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // když nikdo neťuká, sem tam kápne kapka
    if (t - lastTap > 5 && Math.random() < 0.004) {
      const a = Math.random() * 6.283, rr = Math.random() * CUP.r * 0.6;
      addRipple(CUP.x + Math.cos(a) * rr * IMG.h / IMG.w, CUP.y + Math.sin(a) * rr, 0.55);
      lastTap = t - 2;
    }
  }
  updateBeans();
}
gsap.ticker.add(frame);

stage.addEventListener('pointermove', e => {
  const r = stage.getBoundingClientRect();
  const nx = (e.clientX - r.left) / r.width, ny = 1 - (e.clientY - r.top) / r.height;
  if (e.pointerType === 'mouse') {
    wind.x = clamp(wind.x + (nx - mouse.x) * 0.9, -0.12, 0.12);
    wind.y = clamp(wind.y + (ny - mouse.y) * 0.9, -0.12, 0.12);
    mouse.tOn = 1;
  }
  mouse.x = nx; mouse.y = ny;
  pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top; pointer.on = true;
}, { passive: true });
stage.addEventListener('pointerleave', () => { mouse.tOn = 0; pointer.on = false; });
stage.addEventListener('pointerdown', e => {
  if (e.target.closest('a,button')) return;
  const [ux, uy] = screenToImg(e.clientX, e.clientY);
  lastTap = performance.now() / 1000 - t0;
  if (inCoffee(ux, uy)) addRipple(ux, uy, 1);
  else {
    // ťuk mimo kávu: vlnka přijde od okraje nejbližšího místa
    const dx = (ux - CUP.x) * IMG.w / IMG.h, dy = uy - CUP.y, L = Math.hypot(dx, dy) || 1;
    const rr = CUP.r * 0.88;
    addRipple(CUP.x + dx / L * rr * IMG.h / IMG.w, CUP.y + dy / L * rr, 0.7);
    kickBeans(e.clientX, e.clientY);
  }
});

/* ---------- zrnka kolem šálku ---------- */
const beans = [];
const pointer = { x: -999, y: -999, on: false };
function makeBeans() {
  const n = innerWidth < 640 ? 6 : 12;
  const rnd = mulberry(7);
  for (let i = 0; i < n; i++) {
    const im = document.createElement('img');
    im.src = `img/zrno${(i % 14) + 1}.webp`; im.alt = ''; im.className = 'bean'; im.setAttribute('aria-hidden', 'true');
    const s = innerWidth < 640 ? 26 + rnd() * 20 : 34 + rnd() * 30;
    im.style.setProperty('--s', s + 'px');
    stage.insertBefore(im, heroDark);
    beans.push({ el: im, s, a: 0, d: 0, rot: rnd() * 360, rs: (rnd() - .5) * 40, ph: rnd() * 6.28, depth: .5 + rnd(), ox: 0, oy: 0, vx: 0, vy: 0, seed: rnd() });
  }
  placeBeans();
}
function placeBeans() {
  if (!beans.length) return;
  const portrait = srcKey === 'port';
  const rnd = mulberry(11);
  beans.forEach((b, i) => {
    // na šířku: jen pravá polovina kruhu (vlevo je text); na výšku: horní tři čtvrtiny
    const span = portrait ? [-200, 20] : [-110, 110];
    const ang = (span[0] + (span[1] - span[0]) * ((i + rnd() * .7) / beans.length)) * Math.PI / 180;
    const d = cupScreen.r * (1.75 + rnd() * (portrait ? .8 : 1.2));
    const vw = stage.clientWidth, vh = stage.clientHeight;
    b.hx = clamp(cupScreen.x + Math.cos(ang) * d * (portrait ? 1 : 1.15), 24, vw - 24 - b.s);
    b.hy = clamp(cupScreen.y + Math.sin(ang) * d, 96, vh - 30 - b.s);
  });
}
function kickBeans(px, py) {
  const r = stage.getBoundingClientRect();
  beans.forEach(b => {
    const dx = b.hx + b.ox - (px - r.left), dy = b.hy + b.oy - (py - r.top), L = Math.hypot(dx, dy) || 1;
    if (L < 260) { const f = (260 - L) / 260 * 22; b.vx += dx / L * f; b.vy += dy / L * f; b.rs += (Math.random() - .5) * 300; }
  });
}
function updateBeans() {
  if (!beans.length || !heroVisible) return;
  const t = performance.now() / 1000, p = state.heroP;
  beans.forEach(b => {
    // odpuzování kurzorem
    if (pointer.on) {
      const dx = b.hx + b.ox - pointer.x, dy = b.hy + b.oy - pointer.y, L = Math.hypot(dx, dy) || 1;
      if (L < 130) { const f = (130 - L) / 130 * 1.6; b.vx += dx / L * f; b.vy += dy / L * f; }
    }
    b.vx += -b.ox * 0.04; b.vy += -b.oy * 0.04;
    b.vx *= 0.86; b.vy *= 0.86;
    b.ox += b.vx; b.oy += b.vy;
    b.rs *= 0.97; b.rot += b.rs * 0.016 + Math.sin(t * .6 + b.ph) * .05;
    // při ponoru zrnka ujíždějí ven z obrazu (paralaxa)
    const ex = (b.hx - cupScreen.x) * (1 + p * p * 6 * b.depth), ey = (b.hy - cupScreen.y) * (1 + p * p * 6 * b.depth);
    const x = cupScreen.x + ex + b.ox - b.s / 2, y = cupScreen.y + ey + b.oy - b.s / 2 + Math.sin(t * .8 + b.ph) * 1.5;
    const sc = 1 + p * p * 3 * b.depth;
    b.el.style.opacity = clamp(1 - p * 2.2, 0, 1).toFixed(3);
    b.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) rotate(${b.rot.toFixed(1)}deg) scale(${sc.toFixed(3)})`;
  });
}
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

ScrollTrigger.create({
  trigger: hero, start: 'top top', end: 'bottom bottom', scrub: true,
  onUpdate: s => {
    state.heroP = s.progress;
    const p = s.progress;
    heroCopy.style.opacity = clamp(1 - p * 3.2, 0, 1);
    heroCopy.style.transform = innerWidth < 641 ? `translateY(${(-p * 120).toFixed(1)}px)` : `translateY(calc(-44% - ${(p * 160).toFixed(1)}px))`;
    heroDark.style.opacity = smooth(clamp((p - .7) / .24, 0, 1));
    nav.classList.toggle('is-dark-hero', p > .55 && p < 1);
  }
});
ScrollTrigger.create({ trigger: hero, start: 'top top', end: 'bottom top', onToggle: s => { heroVisible = s.isActive; } });

const glOk = initGL();
if (glOk) {
  state.gl = true;
  loadTex(SRC[srcKey].src()).then(() => { resize(); }).catch(() => { document.documentElement.classList.add('no-gl'); state.gl = false; gl = null; });
} else { document.documentElement.classList.add('no-gl'); }
computeMap(); makeBeans();
let rT; addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => {
  const k = isPortrait() ? 'port' : 'land';
  if (k !== srcKey) {   // otočení telefonu: jiná fotka
    srcKey = k; IMG = { w: SRC[k].w, h: SRC[k].h }; CUP = SRC[k].cup;
    if (gl) loadTex(SRC[k].src()).then(resize);
  }
  resize(); ScrollTrigger.refresh();
}, 120); });
resize();

/* =========================================================
   ŽÁR — křivka pražení
   ========================================================= */
const T_END = 12;                                   // minut
const BT = t => 20 + 192 * (1 - Math.exp(-t / 3.6)); // teplota zrna
const C = { x0: 46, x1: 624, y0: 296, y1: 20, tMax: 240 };
const cx = t => C.x0 + (C.x1 - C.x0) * t / T_END;
const cy = T => C.y0 - (C.y0 - C.y1) * T / C.tMax;
const svg = $('#curveSvg');
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent && parent.append(e); return e; };
(function buildCurve() {
  const g = $('.curve__grid', svg);
  [0, 50, 100, 150, 200].forEach(T => {
    el('line', { x1: C.x0, x2: C.x1, y1: cy(T), y2: cy(T) }, g);
    el('text', { x: C.x0 - 10, y: cy(T) + 4, 'text-anchor': 'end' }, g).textContent = T + '°';
  });
  [0, 3, 6, 9, 12].forEach(m => {
    el('text', { x: cx(m), y: C.y0 + 20, 'text-anchor': 'middle' }, g).textContent = m + ' min';
  });
  let d = '';
  for (let i = 0; i <= 120; i++) { const t = T_END * i / 120; d += (i ? 'L' : 'M') + cx(t).toFixed(1) + ' ' + cy(BT(t)).toFixed(1); }
  $('#curveGhost').setAttribute('d', d);
  $('#curveLine').setAttribute('d', d);
  const defs = el('defs', {}, null); svg.prepend(defs);
  const lg = el('linearGradient', { id: 'heatGrad', x1: 0, x2: 1, y1: 0, y2: 0 }, defs);
  [['0', '#a3a882'], ['.42', '#d8b65e'], ['.78', '#e07a52'], ['1', '#c4532d']].forEach(([o, c]) => el('stop', { offset: o, 'stop-color': c }, lg));
})();
const curveLine = $('#curveLine'), curveDot = $('#curveDot');
const curveLen = curveLine.getTotalLength();
curveLine.style.strokeDasharray = curveLen; curveLine.style.strokeDashoffset = curveLen;
const tTemp = $('#tTemp'), tTime = $('#tTime'), heatStage = $('#heatStage'), heatBig = $('#heatBig');
const heatCols = ['#a3a882', '#d8c27a', '#d8b65e', '#e07a52', '#f3e3cf'];
const heatColAt = gsap.utils.interpolate(heatCols);
const heatSec = $('#zar');
function setHeat(p) {
  const t = p * T_END, T = BT(t);
  curveLine.style.strokeDashoffset = curveLen * (1 - p);
  const pt = curveLine.getPointAtLength(curveLen * p);
  curveDot.setAttribute('cx', pt.x); curveDot.setAttribute('cy', pt.y);
  tTemp.textContent = Math.round(T);
  const mm = Math.floor(t), ss = Math.floor((t - mm) * 60);
  tTime.textContent = mm + ':' + String(ss).padStart(2, '0');
  let st = 'Sušení';
  if (t >= 5) st = 'Žloutnutí a hnědnutí';
  if (t >= 9.5) st = 'První prasknutí';
  if (t >= 10.4) st = 'Vývoj chuti';
  if (p >= .985) st = 'Ven z bubnu, chlazení';
  if (heatStage.textContent !== st) {
    heatStage.textContent = st;
    if (st === 'První prasknutí') crackBurst();
  }
  MARKS.forEach(m => { const on = t >= m.t - .02; m.c.classList.toggle('on', on); m.tx.classList.toggle('on', on); });
  heatBig.style.fontVariationSettings = `"wght" ${Math.round(200 + 600 * smooth(p))}, "SOFT" ${Math.round(100 * p)}, "WONK" ${p > .8 ? 1 : 0}`;
  heatBig.style.color = heatColAt(p);
  heatSec.style.setProperty('--g', smooth(p).toFixed(3));
  embers.heat = p;
  state.heat = +p.toFixed(3);
}
const MARKS = [
  { t: 5, label: 'Žlutá fáze', dy: 46, anchor: 'end' },
  { t: 9.5, label: 'První prasknutí', dy: 58, anchor: 'end' },
  { t: 12, label: 'Konec', dy: 34, anchor: 'end' }
];
(function buildMarks() {
  const mg = $('.curve__marks', svg); mg.innerHTML = '';
  MARKS.forEach(m => {
    const x = cx(m.t), y = cy(BT(m.t));
    m.l = el('line', { x1: x, x2: x, y1: y - 9, y2: y - m.dy, stroke: 'rgba(251,246,238,.28)', 'stroke-dasharray': '2 4' }, mg);
    m.c = el('circle', { cx: x, cy: y, r: 6 }, mg);
    m.tx = el('text', { x: x - 2, y: y - m.dy - 8, 'text-anchor': m.anchor }, mg);
    m.tx.textContent = m.label;
  });
})();

/* jiskry v pozadí: čím víc žáru, tím víc jisker; při prasknutí výbuch */
const embers = { heat: 0, list: [], cv: null, ctx: null, on: false };
(function initEmbers() {
  const cv = document.createElement('canvas'); cv.className = 'heat__embers'; cv.setAttribute('aria-hidden', 'true');
  const pin = $('.heat__pin'); pin.prepend(cv); embers.cv = cv; embers.ctx = cv.getContext('2d');
  const size = () => { const d = Math.min(devicePixelRatio || 1, 1.5); cv.width = pin.clientWidth * d; cv.height = pin.clientHeight * d; embers.d = d; };
  size(); addEventListener('resize', size);
  ScrollTrigger.create({ trigger: heatSec, start: 'top bottom', end: 'bottom top', onToggle: s => { embers.on = s.isActive; } });
  gsap.ticker.add(() => {
    if (!embers.on || reduce) return;
    const { ctx, cv, list } = embers, d = embers.d, W = cv.width, H = cv.height;
    const want = 4 + embers.heat * 70;
    if (list.length < want && Math.random() < .5 + embers.heat) list.push(spark(W, H, d, false));
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      s.x += s.vx + Math.sin(s.y * .01 + s.ph) * .35 * d; s.y += s.vy; s.vy *= .995; s.life -= s.dl;
      if (s.life <= 0 || s.y < -10) { list.splice(i, 1); continue; }
      const a = Math.min(1, s.life * 2) * s.a;
      ctx.fillStyle = `rgba(${s.c},${a.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  });
})();
function spark(W, H, d, burst) {
  const hot = Math.random() < embers.heat;
  return {
    x: burst ? W * (.55 + Math.random() * .4) : Math.random() * W, y: burst ? H * (.45 + Math.random() * .3) : H + 10,
    vx: (Math.random() - .5) * (burst ? 3 : .4) * d, vy: -(burst ? 1.5 + Math.random() * 3.5 : .4 + Math.random() * 1.4) * d,
    r: (burst ? .8 + Math.random() * 1.8 : .6 + Math.random() * 1.6) * d, life: 1, dl: .004 + Math.random() * .008,
    a: .35 + Math.random() * .55, ph: Math.random() * 6, c: hot ? '255,150,80' : '230,190,120'
  };
}
function crackBurst() {
  if (reduce || !embers.cv) return;
  for (let i = 0; i < 46; i++) embers.list.push(spark(embers.cv.width, embers.cv.height, embers.d, true));
  gsap.fromTo('.curve__read b', { scale: 1.08 }, { scale: 1, duration: .5, ease: 'elastic.out(1,.4)', overwrite: true });
}

const heatMM = gsap.matchMedia();
heatMM.add({ big: '(min-width: 641px)', small: '(max-width: 640px)' }, ctx => {
  const st = ScrollTrigger.create({
    trigger: '.heat__pin', start: 'top top', end: () => '+=' + Math.round(innerHeight * (ctx.conditions.big ? 2.4 : 1.8)),
    pin: true, scrub: true, anticipatePin: 1,
    onUpdate: s => setHeat(s.progress)
  });
  return () => st.kill();
});
setHeat(0);

/* =========================================================
   CESTA — od zrna k šálku
   ========================================================= */
const pathImgs = $$('#pathImg img'), stepsLi = $$('#steps li'), pathBar = $('#pathBar');
pathImgs.forEach((im, i) => {
  im.classList.remove('is-on');
  gsap.set(im, { clipPath: i === 0 ? 'circle(75% at 50% 50%)' : 'circle(0% at 50% 50%)', scale: i === 3 ? 1.6 : 1.22 });
});
let curStep = 0;
function setPath(p) {
  const s = p * 3.4;
  pathImgs.forEach((im, i) => {
    const rot = (p * 28 - i * 6);
    if (i > 0) {
      const k = smooth(clamp((s - (i - .5)) / .55, 0, 1));
      im.style.clipPath = `circle(${(k * 75).toFixed(2)}% at 50% 50%)`;
    }
    im.style.transform = `scale(${i === 3 ? 1.6 : 1.22}) rotate(${i === 3 ? 0 : rot.toFixed(2)}deg)`;
  });
  const idx = clamp(Math.round(s - .05), 0, 3);
  if (idx !== curStep) { curStep = idx; stepsLi.forEach((li, i) => li.classList.toggle('is-on', i === idx)); }
  pathBar.style.width = (p * 100).toFixed(2) + '%';
  state.path = +p.toFixed(3); state.step = idx;
}
ScrollTrigger.create({
  trigger: '.path__pin', start: 'top top', end: () => '+=' + Math.round(innerHeight * 2.2),
  pin: true, scrub: true, anticipatePin: 1, onUpdate: s => setPath(s.progress)
});
setPath(0);

/* =========================================================
   KÁVY
   ========================================================= */
const beansSec = $('#kavy'), cartN = $('#cartN'), flying = $('#flying');
let cart = 0;
$$('.roast').forEach(r => $$('i', r).forEach((i, k) => i.classList.toggle('on', k < +r.dataset.r)));
$$('.bag').forEach((bag, bi) => {
  const pic = $('.bag__pic', bag), obj = $('.bag__obj', bag);
  if (!coarse) {
    pic.addEventListener('pointermove', e => {
      const r = pic.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      obj.style.setProperty('--ry', (x * 22).toFixed(2) + 'deg');
      obj.style.setProperty('--rx', (-y * 12).toFixed(2) + 'deg');
    });
    pic.addEventListener('pointerleave', () => { obj.style.setProperty('--ry', '0deg'); obj.style.setProperty('--rx', '0deg'); });
  }
  bag.addEventListener('pointerenter', () => { beansSec.style.background = getComputedStyle(bag).getPropertyValue('--c2'); });
  bag.addEventListener('pointerleave', () => { beansSec.style.background = ''; });
  const chips = $$('.chips button', bag);
  chips.forEach(c => {
    c.setAttribute('role', 'radio'); c.setAttribute('aria-checked', c.classList.contains('is-on'));
    c.addEventListener('click', () => { chips.forEach(o => { o.classList.toggle('is-on', o === c); o.setAttribute('aria-checked', o === c); }); });
  });
  $('.add', bag).addEventListener('click', e => {
    const grind = $('.chips .is-on', bag).textContent;
    flyBean(e.currentTarget, bi);
    const name = $('h3', bag).textContent;
    toast(`${name} (${grind.toLowerCase()}) je v košíku. Tohle je ukázka, nic se neobjednává.`);
  });
});
function flyBean(from, i) {
  const a = from.getBoundingClientRect(), b = cartN.getBoundingClientRect();
  const n = 5;
  for (let k = 0; k < n; k++) {
    const im = document.createElement('img'); im.src = `img/zrno${((i * 4 + k) % 14) + 1}.webp`; im.alt = '';
    flying.append(im);
    const x0 = a.left + a.width / 2 - 22 + (Math.random() - .5) * 30, y0 = a.top + a.height / 2 - 22;
    const x1 = b.left + b.width / 2 - 22, y1 = b.top + b.height / 2 - 22;
    const tl = gsap.timeline({ delay: k * .06, onComplete: () => { im.remove(); if (k === n - 1) bumpCart(); } });
    tl.set(im, { x: x0, y: y0, rotation: Math.random() * 360, scale: .6 });
    tl.to(im, { x: x1, duration: .85, ease: 'power1.in' }, 0);
    tl.to(im, { y: Math.min(y0, y1) - 140 - Math.random() * 60, duration: .4, ease: 'power2.out' }, 0);
    tl.to(im, { y: y1, duration: .45, ease: 'power2.in' }, .4);
    tl.to(im, { rotation: '+=420', scale: .4, duration: .85, ease: 'none' }, 0);
  }
}
function bumpCart() {
  cart++; cartN.textContent = cart; cartN.classList.add('bump');
  setTimeout(() => cartN.classList.remove('bump'), 260);
  state.cart = cart;
}
gsap.from('.bag', { y: 80, opacity: 0, duration: 1.1, ease: 'power3.out', stagger: .14, scrollTrigger: { trigger: '.bags', start: 'top 82%' } });

/* =========================================================
   PŘÍPRAVA — dávkování a časovač
   ========================================================= */
const METHODS = {
  v60: {
    ratio: 16, time: 180, min: 200, max: 600, def: 300, grind: 'středně jemně, jako mořská sůl',
    plan: w => [[0, `Spaření: zalít ${Math.round(w * .13 / 5) * 5} ml a počkat`], [40, `V kroužcích dolít do ${Math.round(w * .6 / 10) * 10} ml`], [90, `Dolít do ${w} ml`], [120, 'Nechat protéct'], [180, 'Hotovo, dobrou chuť']]
  },
  aero: {
    ratio: 14, time: 120, min: 150, max: 250, def: 220, grind: 'jemně, jako jemný písek',
    plan: w => [[0, `Zalít ${w} ml vody`], [10, 'Promíchat, nasadit píst'], [60, 'Nasadit píst, ať neprokapává'], [90, 'Pomalu tlačit 30 sekund'], [120, 'Hotovo, dobrou chuť']]
  },
  french: {
    ratio: 15, time: 240, min: 300, max: 1000, def: 500, grind: 'hrubě, jako hrubá sůl',
    plan: w => [[0, `Zalít ${w} ml vody`], [30, 'Krátce promíchat'], [210, 'Sebrat pěnu z hladiny'], [235, 'Pomalu stlačit sítko'], [240, 'Hned nalít, dobrou chuť']]
  }
};
const water = $('#water'), waterOut = $('#waterOut'), doseG = $('#doseG'), doseR = $('#doseR'), doseT = $('#doseT'), grindEl = $('#grind');
const planEl = $('#plan'), timerT = $('#timerT'), timerBtn = $('#timerBtn');
const V = {
  v60: { g: $('#vV60'), bed: $('#bed'), water: $('#cone'), drop: $('#drop'), pot: $('#pot'), dy: [208, 360] },
  aero: { g: $('#vAero'), water: $('#aW'), pl: $('#aPl'), drop: $('#aDrop'), pot: $('#aMug'), dy: [240, 364] },
  french: { g: $('#vFrench'), water: $('#fW'), crust: $('#fCrust'), pl: $('#fPl') }
};
let method = 'v60', brewT = 0, running = false, lastTick = 0, preview = null;
const fmt = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
const brewCol = gsap.utils.interpolate(['#d39a62', '#9a5a2e', '#5a3018', '#2e170b']);
function setMethod(m) {
  if (dropAnim) { dropAnim.kill(); dropAnim = null; }
  method = m; const M = METHODS[m];
  water.min = M.min; water.max = M.max; water.value = M.def;
  $$('#tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.m === m));
  for (const k in V) V[k].g.toggleAttribute('hidden', k !== m);   // SVG nemá vlastnost .hidden
  brewT = 0; stopTimer(); updateBrew();
  gsap.fromTo(V[m].g, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: .5, ease: 'power2.out' });
}
function updateBrew() {
  const M = METHODS[method], w = +water.value;
  water.style.setProperty('--v', ((w - M.min) / (M.max - M.min) * 100).toFixed(1) + '%');
  waterOut.textContent = w + ' ml';
  doseG.textContent = Math.round(w / M.ratio);
  doseR.textContent = '1 : ' + M.ratio;
  doseT.textContent = fmt(M.time);
  grindEl.textContent = M.grind;
  planEl.innerHTML = M.plan(w).map(([s, txt]) => `<li data-s="${s}"><b>${fmt(s)}</b><span>${txt}</span></li>`).join('');
  drawBrew();
}
function drawBrew() {
  const M = METHODS[method], T = M.time, t = brewT, v = V[method];
  timerT.textContent = fmt(t);
  const lis = $$('li', planEl);
  let cur = -1; lis.forEach((li, i) => { if (t >= +li.dataset.s) cur = i; });
  lis.forEach((li, i) => { li.classList.toggle('on', i === cur && t > 0); li.classList.toggle('done', i < cur || (t >= T && i === cur)); });
  let poured, drained, dropping = false;
  if (method === 'v60') {
    poured = t < 10 ? t / 10 * .13 : t < 40 ? .13 : t < 70 ? .13 + (t - 40) / 30 * .47 : t < 90 ? .6 : t < 115 ? .6 + (t - 90) / 25 * .4 : 1;
    drained = Math.min(poured, clamp((t - 14) / (T - 22), 0, 1));
    const up = clamp(poured - drained, 0, 1);
    const lvl = 196 - Math.pow(up, .8) * 130;           // hladina v kuželu: 196 prázdno, 66 plno
    v.water.setAttribute('y', lvl.toFixed(1)); v.water.setAttribute('height', (200 - lvl).toFixed(1));
    v.bed.setAttribute('y', (166 - (t > 0 && t < T ? 6 + Math.sin(t * 2) * 1.2 : 0)).toFixed(1));
    const ph = drained * 100; v.pot.setAttribute('y', (372 - ph).toFixed(1)); v.pot.setAttribute('height', ph.toFixed(1));
    dropping = up > .01 && t > 6 && t < T;
  } else if (method === 'aero') {
    poured = clamp(t / 8, 0, 1);
    drained = t < 90 ? Math.min(poured, t / 90) * .05 : .05 + clamp((t - 90) / 30, 0, 1) * .95;
    const up = clamp(poured - drained, 0, 1);
    const top = 230 - up * 170;                            // hladina v komoře
    v.water.setAttribute('y', top.toFixed(1)); v.water.setAttribute('height', (230 - top).toFixed(1));
    v.water.style.fill = brewCol(clamp(t / 60, 0, 1) * .8);
    const plOn = t >= 60;
    v.pl.setAttribute('opacity', plOn ? 1 : 0);
    // spodek pístu (y=40 v jeho souřadnicích) sedí kousek nad hladinou
    const ty = plOn ? Math.max(0, top - 44) : -30;
    v.pl.setAttribute('transform', `translate(0 ${ty.toFixed(1)})`);
    const ph = drained * 92; v.pot.setAttribute('y', (372 - ph).toFixed(1)); v.pot.setAttribute('height', ph.toFixed(1));
    dropping = t > 8 && (t < 60 || (t >= 90 && t < T));
  } else {
    poured = clamp(t / 10, 0, 1); drained = 0;
    const top = 362 - poured * 176;
    v.water.setAttribute('y', top.toFixed(1)); v.water.setAttribute('height', (362 - top).toFixed(1));
    v.water.setAttribute('fill', brewCol(clamp(t / 200, 0, 1)));
    // kůrka z kávy plave nahoře, po promíchání klesá
    const crust = t > 0 ? clamp(1 - (t - 30) / 40, 0, 1) : 0;
    v.crust.setAttribute('y', top.toFixed(1)); v.crust.setAttribute('opacity', crust.toFixed(2));
    const press = clamp((t - 235) / 5, 0, 1);
    v.pl.setAttribute('transform', `translate(0 ${(press * 176).toFixed(1)})`);
  }
  if (v.drop) {
    v.drop.style.opacity = dropping ? 1 : 0;
    if (dropping && !dropAnim) dropAnim = gsap.fromTo(v.drop, { attr: { cy: v.dy[0] } }, { attr: { cy: v.dy[1] }, duration: .55, ease: 'power2.in', repeat: -1, repeatDelay: .05 });
    if (dropAnim) (dropping && (running || preview)) ? dropAnim.resume() : dropAnim.pause();
  }
  state.brew = { m: method, t: Math.round(t), poured: +poured.toFixed(2), down: +drained.toFixed(2) };
}
let dropAnim = null;
function startTimer() {
  if (preview) { preview.kill(); preview = null; brewT = 0; }
  if (brewT >= METHODS[method].time) brewT = 0;
  running = true; lastTick = performance.now(); timerBtn.textContent = 'Pozastavit';
}
function stopTimer() { running = false; timerBtn.textContent = brewT > 0 && brewT < METHODS[method].time ? 'Pokračovat' : 'Spustit'; if (dropAnim) dropAnim.pause(); }
gsap.ticker.add(() => {
  if (!running) return;
  const now = performance.now(); brewT = Math.min(METHODS[method].time, brewT + (now - lastTick) / 1000); lastTick = now;
  drawBrew();
  if (brewT >= METHODS[method].time) { running = false; timerBtn.textContent = 'Znovu'; drawBrew(); toast('Hotovo. Dobrou chuť.'); }
});
timerBtn.addEventListener('click', () => running ? stopTimer() : startTimer());
$$('#tabs button').forEach(b => b.addEventListener('click', () => setMethod(b.dataset.m)));
water.addEventListener('input', () => { if (preview) { preview.kill(); preview = null; } updateBrew(); });
// klávesy šipkami mezi záložkami
$('#tabs').addEventListener('keydown', e => {
  const bs = $$('#tabs button'), i = bs.findIndex(b => b.dataset.m === method);
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const j = (i + (e.key === 'ArrowRight' ? 1 : bs.length - 1)) % bs.length; setMethod(bs[j].dataset.m); bs[j].focus();
  }
});
setMethod('v60');
window.__brew = (m, t) => { setMethod(m); brewT = t; drawBrew(); };
// když se sekce poprvé ukáže, celá příprava proběhne zrychleně za 5 s a vrátí se na nulu
ScrollTrigger.create({
  trigger: '#priprava', start: 'top 60%', once: true, onEnter: () => {
    if (reduce || running) return;
    const o = { t: 0 };
    preview = gsap.to(o, { t: METHODS[method].time, duration: 5.5, ease: 'none', onUpdate: () => { brewT = o.t; drawBrew(); },
      onComplete: () => { preview = null; drawBrew(); gsap.delayedCall(1.2, () => { if (!running) { brewT = 0; drawBrew(); } }); } });
  }
});

/* =========================================================
   PATIČKA — písmena ztloustnou pod kurzorem
   ========================================================= */
const word = $('.foot__word');
(function splitLetters(node) {
  [...node.childNodes].forEach(n => {
    if (n.nodeType === 3) {
      const frag = document.createDocumentFragment();
      [...n.textContent].forEach(ch => {
        if (ch === ' ') { frag.append(' '); return; }
        const s = document.createElement('span'); s.className = 'l'; s.textContent = ch; frag.append(s);
      });
      n.replaceWith(frag);
    } else if (n.nodeType === 1) splitLetters(n);
  });
})(word);
const letters = $$('.l', word);
const foot = $('.foot');
let fx = -1e4, fy = -1e4, fOn = false;
foot.addEventListener('pointermove', e => { fx = e.clientX; fy = e.clientY; fOn = true; }, { passive: true });
foot.addEventListener('pointerleave', () => { fOn = false; });
let footVis = false;
ScrollTrigger.create({ trigger: foot, start: 'top bottom', end: 'bottom top', onToggle: s => { footVis = s.isActive; } });
gsap.ticker.add(() => {
  if (!footVis) return;
  const t = performance.now() / 1000;
  letters.forEach((l, i) => {
    const r = l.getBoundingClientRect();
    let k;
    if (fOn && !coarse) { const d = Math.hypot(r.left + r.width / 2 - fx, r.top + r.height / 2 - fy); k = Math.exp(-(d * d) / (2 * 150 * 150)); }
    else k = .5 + .5 * Math.sin(t * 1.3 - i * .55);
    const cur = +l.dataset.k || 0, nk = cur + (k - cur) * .12; l.dataset.k = nk.toFixed(4);
    l.style.fontVariationSettings = `"wght" ${Math.round(250 + 600 * nk)}, "SOFT" 100, "WONK" ${nk > .6 ? 1 : 0}`;
  });
});

/* ---------- nav nad tmavými sekcemi (až po pinech, ať sedí jejich délka) ---------- */
ScrollTrigger.create({ trigger: '#zar', start: 'top 64px', end: 'bottom 64px', toggleClass: { targets: nav, className: 'is-dark' } });
ScrollTrigger.create({ trigger: '.foot', start: 'top 64px', end: 'bottom top', toggleClass: { targets: nav, className: 'is-dark' } });

/* ---------- start ---------- */
addEventListener('load', () => { document.documentElement.classList.add('ready'); ScrollTrigger.refresh(); });
setTimeout(() => document.documentElement.classList.add('ready'), 2500);

window.__state = () => ({ heroP: +state.heroP.toFixed(3), gl: state.gl, ripples: state.ripples, heat: state.heat, path: state.path, step: state.step, cart: state.cart || 0, brew: state.brew, scroll: Math.round(scrollY), nav: nav.className });
})();
