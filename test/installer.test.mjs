import test from "node:test";
import assert from "node:assert/strict";
import zlib from "zlib";
import { unzipEntry, assetName } from "../src/proxy/v2ray/installer.mjs";

/** Build a tiny valid zip in memory (stored + deflate entries). */
function makeZip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, data, deflate] of files) {
    const nameBuf = Buffer.from(name);
    const comp = deflate ? zlib.deflateRawSync(data) : data;
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4);
    l.writeUInt16LE(deflate ? 8 : 0, 8);
    l.writeUInt32LE(comp.length, 18); l.writeUInt32LE(data.length, 22);
    l.writeUInt16LE(nameBuf.length, 26);
    locals.push(l, nameBuf, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6);
    c.writeUInt16LE(deflate ? 8 : 0, 10);
    c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

test("unzipEntry reads deflated and stored entries by basename", () => {
  const big = Buffer.alloc(50_000, "xray-binary-");
  const zip = makeZip([["LICENSE", Buffer.from("mit"), false], ["dir/xray", big, true], ["geoip.dat", Buffer.from("geo"), true]]);
  assert.ok(unzipEntry(zip, "xray").equals(big));
  assert.equal(unzipEntry(zip, "LICENSE").toString(), "mit");
  assert.throws(() => unzipEntry(zip, "missing.exe"), /not found/);
  assert.throws(() => unzipEntry(Buffer.from("definitely not a zip"), "xray"), /not a zip/);
});

test("assetName covers common platforms", () => {
  assert.equal(assetName("win32", "x64"), "Xray-windows-64.zip");
  assert.equal(assetName("linux", "x64"), "Xray-linux-64.zip");
  assert.equal(assetName("linux", "arm64"), "Xray-linux-arm64-v8a.zip");
  assert.equal(assetName("darwin", "arm64"), "Xray-macos-arm64-v8a.zip");
  assert.equal(assetName("sunos", "x64"), null);
});
