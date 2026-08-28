/* Melted chrome.
   Two things carry this look and neither is colour:
     1. curvature — a blob whose normal sweeps the FULL hemisphere, so the
        reflection runs the whole environment across the face instead of
        sampling one narrow band the way a flat slab does;
     2. the environment itself — a real studio with a hard horizon, a dark
        floor and a couple of blown softboxes. Mirror shading is only as
        interesting as the world it reflects. */

var clamp=function(x,a,b){return x<a?a:(x>b?b:x);};
var mix=function(a,b,t){return a+(b-a)*t;};
var sstep=function(e0,e1,x){var t=clamp((x-e0)/(e1-e0),0,1);return t*t*(3-2*t);};
var sat=function(x){return clamp(x,0,1);};

function hash2(x,y){var n=Math.sin(x*127.1+y*311.7)*43758.5453123;return n-Math.floor(n);}
function vnoise(x,y){
  var xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi;
  var u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
  var a=hash2(xi,yi),b=hash2(xi+1,yi),c=hash2(xi,yi+1),d=hash2(xi+1,yi+1);
  return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;
}
function fbm(x,y,o){var s=0,a=0.5,f=1;for(var i=0;i<o;i++){s+=a*vnoise(x*f,y*f);f*=2.03;a*=0.5;}return s;}

/* ---------- geometry ---------- */

function seR(u,v,n){
  return Math.pow(Math.pow(Math.abs(u),n)+Math.pow(Math.abs(v),n),1/n);
}

/* A melted container: a rounded-square blob whose outline breathes, so the
   silhouette reads as something that flowed rather than something machined. */
function blobR(u,v,cfg){
  var ang=Math.atan2(v,u);
  var w=1
    + cfg.wob*Math.sin(ang*3+0.7)
    + cfg.wob*0.62*Math.sin(ang*5-1.9)
    + cfg.wob*0.40*Math.sin(ang*2+2.6);
  return seR(u,v,cfg.n)/w;
}

/* Puffy dome plus gentle undulation. A pure dome puts the horizon in one
   straight band across the middle; real melted metal has varying curvature,
   so the horizon snakes. */
function flow(u,v){
  return 0.50*Math.sin(u*2.05+v*1.25+0.7)
       + 0.30*Math.sin(u*1.35-v*2.15-1.1)
       + 0.20*Math.sin(u*3.05+v*2.55+2.3);
}
function heightAt(u,v,cfg){
  var r=blobR(u,v,cfg);
  if(r>=1) return 0;
  var dome=Math.pow(Math.max(0,1-r*r), cfg.puff);
  if(!cfg.undu) return dome;
  return dome*(1+cfg.undu*flow(u,v));
}

function normalAt(u,v,cfg){
  var d=0.0035;
  var hu=(heightAt(u+d,v,cfg)-heightAt(u-d,v,cfg))/(2*d);
  var hv=(heightAt(u,v+d,cfg)-heightAt(u,v-d,cfg))/(2*d);
  hu=clamp(hu,-40,40); hv=clamp(hv,-40,40);
  var nx=-hu*cfg.bump, ny=-hv*cfg.bump, nz=1;
  var l=Math.sqrt(nx*nx+ny*ny+nz*nz);
  return [nx/l,ny/l,nz/l];
}

/* ---------- the studio ---------- */

var gauss=function(x,c,w){var t=(x-c)/w;return Math.exp(-t*t);};

/* rx/ry/rz is the reflected direction. up = -ry because v runs downward. */
/* Colourways are a property of the STUDIO, not of the metal. Chrome has no
   colour of its own — you change what it is standing in. Each palette is
   [sky RGB multiplier, floor RGB multiplier]. */
var PALETTES={
  steel:  {sky:[1.00,1.00,1.00], floor:[1.00,1.00,1.00]},
  y2k:    {sky:[0.88,0.94,1.18], floor:[1.16,0.90,0.68]},
  vapor:  {sky:[1.14,0.82,1.20], floor:[0.72,1.06,1.20]},
  sunset: {sky:[0.94,0.80,1.22], floor:[1.24,0.80,0.58]}
};

function studio(rx,ry,rz,pal){
  var up=clamp(-ry,-1,1);
  /* Sky and floor were computed in separate branches that disagreed by 0.26
     at the boundary, which showed up as a cut-out edge across the flank.
     A horizon in a mirror IS sharp — but it has to be continuous, so blend
     the two over a narrow band instead of stepping between them. */
  var sky = 0.50 + 0.22*sstep(0.03,0.92,up) + 0.07*Math.sin(up*10.5+1.2);
  var flr = 0.05 + 0.19*sstep(-1.00,0.03,up) + 0.17*gauss(up,-0.27,0.09);
  var v = mix(flr, sky, sstep(-0.004,0.011,up));
  v += 0.42*gauss(up, 0.012,0.090);   /* horizon, soft enough not to trace bumps */
  v += 0.34*gauss(up,-0.90,0.11);     /* floor bounce at the very bottom edge    */
  v += 0.44*gauss(rx,-0.50,0.26)*gauss(up, 0.50,0.30);
  v += 0.27*gauss(rx, 0.60,0.20)*gauss(up, 0.24,0.26);
  v -= 0.06*gauss(up,-0.62,0.14);

  var p=PALETTES[pal]||PALETTES.steel;
  var t=sat(up*0.5+0.5);
  return [ v*mix(p.floor[0],p.sky[0],t),
           v*mix(p.floor[1],p.sky[1],t),
           v*mix(p.floor[2],p.sky[2],t) ];
}

function reflectDir(N){
  var d2=2*N[2];
  return [d2*N[0], d2*N[1], d2*N[2]-1];
}

var LX=-0.40,LY=-0.62,LZ=0.68;
var HX,HY,HZ;
(function(){var hx=LX,hy=LY,hz=LZ+1,l=Math.sqrt(hx*hx+hy*hy+hz*hz);HX=hx/l;HY=hy/l;HZ=hz/l;})();
function specular(N,s){return Math.pow(Math.max(0,N[0]*HX+N[1]*HY+N[2]*HZ),s);}

function spectrum(t){
  t=t-Math.floor(t);
  var r=0.5+0.5*Math.cos(6.28318*t);
  var g=0.5+0.5*Math.cos(6.28318*(t-0.3333));
  var b=0.5+0.5*Math.cos(6.28318*(t-0.6667));
  var m=(r+g+b)/3,k=1.45;
  return [m+(r-m)*k,m+(g-m)*k,m+(b-m)*k];
}

/* ---------- variants ---------- */

var VARIANTS=[];
function V(label,cfg,shade){VARIANTS.push({label:label,cfg:cfg,shade:shade});}

var BASE={n:3.6, wob:0.022, puff:0.44, bump:0.40, undu:0.09, unduF:1.5};

function mirror(pal){
  return function(u,v,N,h,r){
    var R=reflectDir(N);
    var c=studio(R[0],R[1],R[2],pal);
    var s=specular(N,3000)*1.6;
    return [c[0]+s,c[1]+s,c[2]+s];
  };
}

var FORM={n:3.6, wob:0.022, puff:0.44, bump:0.40, undu:0.055};

V('Steel',  FORM, mirror('steel'));
V('Y2K',    FORM, mirror('y2k'));
V('Vapor',  FORM, mirror('vapor'));
V('Sunset', FORM, mirror('sunset'));

/* ---------- raster ---------- */

function render(canvas, variant){
  var S=canvas.width, ctx=canvas.getContext('2d');
  var img=ctx.createImageData(S,S), px=img.data;
  var cfg=variant.cfg, pad=0.93, aa=2.2/S;
  for(var y=0;y<S;y++){
    for(var x=0;x<S;x++){
      var u=((x+0.5)/S*2-1)/pad, v=((y+0.5)/S*2-1)/pad;
      var r=blobR(u,v,cfg), i=(y*S+x)*4;
      if(r>=1+aa){px[i+3]=0;continue;}
      var a=sstep(1+aa,1-aa,r);
      var h=heightAt(u,v,cfg);
      var N=normalAt(u,v,cfg);
      var c=variant.shade(u,v,N,h,r);
      px[i]  =clamp(sat(c[0]),0,1)*255;
      px[i+1]=clamp(sat(c[1]),0,1)*255;
      px[i+2]=clamp(sat(c[2]),0,1)*255;
      px[i+3]=a*255;
    }
  }
  ctx.putImageData(img,0,0);
}
