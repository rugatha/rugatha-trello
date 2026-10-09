import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {validContent}=require('../functions/attachments.cjs');
test('trusted format check rejects extension-only model files and invalid UTF-8',()=>{
 assert.equal(validContent(Buffer.from('fake.glb'),'model/gltf-binary'),false);
 assert.equal(validContent(Buffer.from([255,0]),'text/plain'),false);
 assert.equal(validContent(Buffer.from('<svg/>'),'image/png'),false);
 assert.equal(validContent(Buffer.from('Hello 中文'),'text/plain'),true);
 const glb=Buffer.alloc(12);glb.write('glTF');glb.writeUInt32LE(2,4);glb.writeUInt32LE(12,8);
 assert.equal(validContent(glb,'model/gltf-binary'),true);glb.writeUInt32LE(99,8);assert.equal(validContent(glb,'model/gltf-binary'),false);
 const stl=Buffer.alloc(134);stl.writeUInt32LE(1,80);assert.equal(validContent(stl,'model/stl'),true);
 assert.equal(validContent(Buffer.from('%PDF-1.7\n'),'application/pdf'),true);
});
