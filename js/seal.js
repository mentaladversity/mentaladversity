(function (root) {
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function rotr(x, n) {
    return (x >>> n) | (x << (32 - n));
  }

  function sha256(data) {
    var len = data.length;
    var padLen = ((len + 9 + 63) >> 6) << 6;
    var buf = new Uint8Array(padLen);
    buf.set(data);
    buf[len] = 0x80;
    var view = new DataView(buf.buffer);
    var bits = len * 8;
    view.setUint32(padLen - 8, Math.floor(bits / 0x100000000));
    view.setUint32(padLen - 4, bits >>> 0);
    var w = new Uint32Array(64);
    var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    var i, t, s0, s1, ch, maj, temp1, temp2, a, b, c, d, e, f, g, hh;
    for (i = 0; i < padLen; i += 64) {
      for (t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4);
      for (t = 16; t < 64; t++) {
        s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      a = h0; b = h1; c = h2; d = h3; e = h4; f = h5; g = h6; hh = h7;
      for (t = 0; t < 64; t++) {
        s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        ch = (e & f) ^ (~e & g);
        temp1 = (hh + s1 + ch + K[t] + w[t]) >>> 0;
        s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        maj = (a & b) ^ (a & c) ^ (b & c);
        temp2 = (s0 + maj) >>> 0;
        hh = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + hh) >>> 0;
    }
    var out = new Uint8Array(32);
    var ov = new DataView(out.buffer);
    [h0, h1, h2, h3, h4, h5, h6, h7].forEach(function (value, index) {
      ov.setUint32(index * 4, value);
    });
    return out;
  }

  function concat(left, right) {
    var out = new Uint8Array(left.length + right.length);
    out.set(left);
    out.set(right, left.length);
    return out;
  }

  function u32(n) {
    var out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, n);
    return out;
  }

  function hmac(key, msg) {
    var k = key.length > 64 ? sha256(key) : key;
    var block = new Uint8Array(64);
    block.set(k);
    var ipad = new Uint8Array(64);
    var opad = new Uint8Array(64);
    var i;
    for (i = 0; i < 64; i++) {
      ipad[i] = block[i] ^ 0x36;
      opad[i] = block[i] ^ 0x5c;
    }
    return sha256(concat(opad, sha256(concat(ipad, msg))));
  }

  function pbkdf2(password, salt, iterations, size) {
    var block = 1;
    var filled = 0;
    var out = new Uint8Array(size);
    while (filled < size) {
      var u = hmac(password, concat(salt, u32(block)));
      var t = new Uint8Array(u);
      var round, j;
      for (round = 1; round < iterations; round++) {
        u = hmac(password, u);
        for (j = 0; j < t.length; j++) t[j] ^= u[j];
      }
      var take = Math.min(t.length, size - filled);
      out.set(t.subarray(0, take), filled);
      filled += take;
      block += 1;
    }
    return out;
  }

  function same(left, right) {
    if (left.length !== right.length) return false;
    var diff = 0;
    var i;
    for (i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
    return diff === 0;
  }

  function bytesOf(text) {
    var bin = atob(text);
    var out = new Uint8Array(bin.length);
    var i;
    for (i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function unseal(packed, key) {
    if (!packed || packed.v !== 2) throw new Error("nope");
    var password = new TextEncoder().encode(key);
    var material = pbkdf2(password, bytesOf(packed.salt), packed.iter || 20000, 64);
    var encKey = material.subarray(0, 32);
    var macKey = material.subarray(32);
    var iv = bytesOf(packed.iv);
    var ct = bytesOf(packed.ct);
    var tag = bytesOf(packed.tag);
    if (!same(hmac(macKey, concat(iv, ct)), tag)) throw new Error("bad key");
    var plain = new Uint8Array(ct.length);
    var offset = 0;
    var counter = 0;
    while (offset < ct.length) {
      var block = hmac(encKey, concat(iv, u32(counter)));
      var n = Math.min(32, ct.length - offset);
      var i;
      for (i = 0; i < n; i++) plain[offset + i] = ct[offset + i] ^ block[i];
      offset += n;
      counter += 1;
    }
    var items = JSON.parse(new TextDecoder().decode(plain));
    if (!Array.isArray(items)) throw new Error("nope");
    return items;
  }

  root.InboxLock = { unseal: unseal, sha256: sha256 };
})(typeof window === "undefined" ? global : window);
