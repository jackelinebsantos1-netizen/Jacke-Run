let watchId;
let timer;
let startTime;
let distance=0;
let lastPos=null;

function startRun(){

startTime=Date.now();

timer=setInterval(updateTimer,1000);

if(navigator.geolocation){
watchId=navigator.geolocation.watchPosition(updateGPS);
}

speak("Treino iniciado");

document.getElementById("status").textContent="Rodando";
}

function stopRun(){

clearInterval(timer);

navigator.geolocation.clearWatch(watchId);

speak("Treino finalizado");

document.getElementById("status").textContent="Finalizado";
}

function updateTimer(){

let sec=Math.floor((Date.now()-startTime)/1000);

let min=Math.floor(sec/60);
let s=String(sec%60).padStart(2,"0");

document.getElementById("time").textContent=min+":"+s;

updatePace(sec);
}

function updateGPS(pos){

let lat=pos.coords.latitude;
let lon=pos.coords.longitude;

if(lastPos){
distance+=calc(lastPos.lat,lastPos.lon,lat,lon);
}

lastPos={lat,lon};

document.getElementById("dist").textContent=(distance/1000).toFixed(2);
}

function updatePace(sec){

if(distance<20)return;

let pace=sec/(distance/1000);

let min=Math.floor(pace/60);
let s=String(Math.round(pace%60)).padStart(2,"0");

document.getElementById("pace").textContent=min+":"+s;
}

function calc(a,b,c,d){

const R=6371000;
const p=Math.PI/180;

const x=(c-a)*p;
const y=(d-b)*p;

const q=Math.sin(x/2)**2+
Math.cos(a*p)*Math.cos(c*p)*
Math.sin(y/2)**2;

return 2*R*Math.asin(Math.sqrt(q));
}

function speak(txt){

if("speechSynthesis" in window){

let u=new SpeechSynthesisUtterance(txt);

u.lang="pt-BR";

speechSynthesis.speak(u);

}
}
