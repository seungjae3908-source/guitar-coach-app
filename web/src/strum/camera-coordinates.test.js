import test from 'node:test';import assert from 'node:assert/strict';import{coverTransform,displayToSource,sourceToDisplay}from'./camera-coordinates.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
for(const config of[
  {name:'portrait crop',videoWidth:1920,videoHeight:1080,displayWidth:390,displayHeight:600,mirrored:false},
  {name:'landscape crop',videoWidth:1080,videoHeight:1920,displayWidth:800,displayHeight:400,mirrored:false},
  {name:'portrait mirrored',videoWidth:1280,videoHeight:720,displayWidth:360,displayHeight:640,mirrored:true},
])test(`${config.name} display-source round trip`,()=>{const t=coverTransform(config),source={x:.37,y:.61},display=sourceToDisplay(source,t),round=displayToSource(display,t);close(source.x,round.x);close(source.y,round.y)});
test('cover transform reports crop offsets',()=>{const portrait=coverTransform({videoWidth:1920,videoHeight:1080,displayWidth:390,displayHeight:600});assert.ok(portrait.cropX>0);assert.equal(portrait.cropY,0);const landscape=coverTransform({videoWidth:1080,videoHeight:1920,displayWidth:800,displayHeight:400});assert.ok(landscape.cropY>0)});
test('mirror maps visual left to source right',()=>{const t=coverTransform({videoWidth:100,videoHeight:100,displayWidth:100,displayHeight:100,mirrored:true});assert.equal(displayToSource({x:10,y:50},t).x,.9)});
