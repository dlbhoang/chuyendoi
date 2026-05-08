const express = require('express');
const app = express();
const PORT = process.env.PORT || 3004;

// ─── Load & parse database ─────────────────────────────────────────────────
const rawData = require('vietnam-address-database');

let provinces = [];
let wards = [];
let wardMappings = [];

rawData.forEach(item => {
  if (item.type === 'table') {
    if (item.name === 'provinces')          provinces    = item.data;
    else if (item.name === 'wards')         wards        = item.data;
    else if (item.name === 'ward_mappings') wardMappings = item.data;
  }
});

// ─── Middleware ────────────────────────────────────────────────────────────
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Chuẩn hoá để so sánh:
 *   - bỏ dấu (NFD + remove combining)
 *   - FIX: convert đ/Đ → d (ký tự riêng, KHÔNG bị remove bởi combining strip)
 *   - lowercase, collapse whitespace
 */
const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')   // FIX: đ là ký tự riêng biệt, không phải d + combining
    .replace(/Đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Chuẩn hoá "lỏng": bỏ thêm tiền tố hành chính để tăng khả năng match.
 */
const normLoose = (s) => {
  const x = norm(s);
  if (!x) return '';
  return x
    .replace(/\b(thanh pho|tp|tinh)\b/g, ' ')
    .replace(/\b(quan|huyen|thi xa|thi tran)\b/g, ' ')
    .replace(/\b(phuong|xa|thon|ap|khu pho)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')   // FIX: bỏ /u flag (không cần sau khi đã norm)
    .replace(/\s+/g, ' ')
    .trim();
};

const paginate = (array, page = 1, limit = 50) => {
  const p = Math.max(1, parseInt(page));
  const l = Math.min(200, Math.max(1, parseInt(limit)));
  const start = (p - 1) * l;
  return {
    data: array.slice(start, start + l),
    meta: { total: array.length, page: p, limit: l, pages: Math.ceil(array.length / l) }
  };
};

// ─── Routes ────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({
    name: 'Vietnam Address API',
    version: '1.0.0',
    description: 'Dữ liệu địa chỉ hành chính Việt Nam theo NQ 202/2025/QH15',
    stats: {
      provinces:     provinces.length,
      wards:         wards.length,
      ward_mappings: wardMappings.length,
    },
    endpoints: {
      provinces: [
        'GET /provinces',
        'GET /provinces/:code',
        'GET /provinces/:code/wards',
      ],
      wards:    ['GET /wards', 'GET /wards/:code'],
      mappings: ['GET /mappings', 'GET /mappings/lookup?old_code=XXXXX'],
      search:   ['GET /search?q=<tên tỉnh hoặc xã>'],
      convert:  [
        'POST /convert  { legacyWardName, legacyDistrictName?, provinceName?, detailAddress? }',
        'POST /convert/batch  [{ legacyWardName, ... }, ...]',
      ],
    },
  });
});

// ─── PROVINCES ─────────────────────────────────────────────────────────────

app.get('/provinces', (req, res) => {
  const { q, page, limit } = req.query;
  let result = provinces;
  if (q) {
    const keyword = q.toLowerCase();
    result = provinces.filter(p =>
      p.name.toLowerCase().includes(keyword) ||
      p.short_name?.toLowerCase().includes(keyword) ||
      p.code?.toLowerCase().includes(keyword)
    );
  }
  res.json(paginate(result, page, limit));
});

app.get('/provinces/:code', (req, res) => {
  const province = provinces.find(p => p.province_code === req.params.code);
  if (!province) return res.status(404).json({ error: 'Không tìm thấy tỉnh/thành phố' });
  res.json(province);
});

app.get('/provinces/:code/wards', (req, res) => {
  const province = provinces.find(p => p.province_code === req.params.code);
  if (!province) return res.status(404).json({ error: 'Không tìm thấy tỉnh/thành phố' });

  const { page, limit, q } = req.query;
  let result = wards.filter(w => w.province_code === req.params.code);
  if (q) {
    const keyword = q.toLowerCase();
    result = result.filter(w => w.name.toLowerCase().includes(keyword));
  }
  res.json({ province, ...paginate(result, page, limit) });
});

// ─── WARDS ─────────────────────────────────────────────────────────────────

app.get('/wards', (req, res) => {
  const { q, page, limit, province_code } = req.query;
  let result = wards;
  if (province_code) result = result.filter(w => w.province_code === province_code);
  if (q) {
    const keyword = q.toLowerCase();
    result = result.filter(w =>
      w.name.toLowerCase().includes(keyword) ||
      w.ward_code?.includes(keyword)
    );
  }
  res.json(paginate(result, page, limit));
});

app.get('/wards/:code', (req, res) => {
  const ward = wards.find(w => w.ward_code === req.params.code);
  if (!ward) return res.status(404).json({ error: 'Không tìm thấy phường/xã' });
  const province = provinces.find(p => p.province_code === ward.province_code);
  res.json({ ...ward, province });
});

// ─── WARD MAPPINGS ─────────────────────────────────────────────────────────

app.get('/mappings', (req, res) => {
  const { page, limit } = req.query;
  res.json(paginate(wardMappings, page, limit));
});

app.get('/mappings/lookup', (req, res) => {
  const { old_code, old_name } = req.query;
  if (!old_code && !old_name)
    return res.status(400).json({ error: 'Cần truyền old_code hoặc old_name' });

  let result = wardMappings;
  if (old_code) result = result.filter(m => m.old_ward_code === old_code);
  if (old_name) {
    const keyword = old_name.toLowerCase();
    result = result.filter(m => m.old_ward_name.toLowerCase().includes(keyword));
  }
  if (result.length === 0)
    return res.status(404).json({ error: 'Không tìm thấy mapping' });
  res.json(result);
});

// ─── SEARCH ────────────────────────────────────────────────────────────────

app.get('/search', (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Cần truyền tham số q' });

  const keyword = q.toLowerCase();
  const matchedProvinces = provinces
    .filter(p => p.name.toLowerCase().includes(keyword) || p.code?.toLowerCase().includes(keyword))
    .slice(0, 10)
    .map(p => ({ ...p, _type: 'province' }));

  const matchedWards = wards
    .filter(w => w.name.toLowerCase().includes(keyword))
    .slice(0, 20)
    .map(w => {
      const province = provinces.find(p => p.province_code === w.province_code);
      return { ...w, province_name: province?.name, _type: 'ward' };
    });

  res.json({
    query: q,
    results: { provinces: matchedProvinces, wards: matchedWards },
    total: matchedProvinces.length + matchedWards.length,
  });
});

// ─── CONVERT: pre-index ────────────────────────────────────────────────────

const mappingIndex = (() => {
  /** @type {Map<string, any[]>} ward name (strict) → mappings */
  const byWard      = new Map();
  /** @type {Map<string, any[]>} ward name (loose)  → mappings */
  const byWardLoose = new Map();
  /** @type {Map<string, Set<string>>} district key → province keys */
  const provinceKeysByDistrict = new Map();
  /** @type {Map<string, any>} old ward code → mapping */
  const byOldWardCode = new Map();

  for (const m of wardMappings) {
    if (m?.old_ward_code != null) byOldWardCode.set(String(m.old_ward_code), m);

    const w  = norm(m?.old_ward_name);
    const wl = normLoose(m?.old_ward_name);
    const d  = norm(m?.old_district_name);
    const dl = normLoose(m?.old_district_name);
    const p  = norm(m?.old_province_name);

    if (w) {
      const arr = byWard.get(w) ?? [];
      arr.push(m);
      byWard.set(w, arr);
    }
    if (wl && wl !== w) {          // avoid double-indexing identical keys
      const arr = byWardLoose.get(wl) ?? [];
      arr.push(m);
      byWardLoose.set(wl, arr);
    }

    for (const dk of [d, dl].filter(Boolean)) {
      const set = provinceKeysByDistrict.get(dk) ?? new Set();
      if (p) set.add(p);
      provinceKeysByDistrict.set(dk, set);
    }
  }

  return { byWard, byWardLoose, provinceKeysByDistrict, byOldWardCode };
})();

const inferProvinceKeyFromDistrict = (legacyDistrictName) => {
  const d  = norm(legacyDistrictName);
  const dl = normLoose(legacyDistrictName);
  const candidates = new Set();
  for (const dk of [d, dl].filter(Boolean)) {
    const set = mappingIndex.provinceKeysByDistrict.get(dk);
    if (set) for (const p of set) candidates.add(p);
  }
  return candidates.size === 1 ? [...candidates][0] : null;
};

/**
 * Score-based best candidate selection.
 * Scores: ward exact=100, ward loose=60, district exact=50, district loose=30,
 *         province exact=40, province loose=20.
 */
const pickBestCandidate = (candidates, keys) => {
  const { wardKey, wardKeyLoose, districtKey, districtKeyLoose, provinceKey, provinceKeyLoose } = keys;

  const scored = candidates.map((m) => {
    const mw  = norm(m?.old_ward_name);
    const mwl = normLoose(m?.old_ward_name);
    const md  = norm(m?.old_district_name);
    const mdl = normLoose(m?.old_district_name);
    const mp  = norm(m?.old_province_name);
    const mpl = normLoose(m?.old_province_name);

    let score = 0;
    if (wardKey      && mw  === wardKey)        score += 100;
    if (wardKeyLoose && mwl === wardKeyLoose)    score += 60;
    if (districtKey      && md  === districtKey)     score += 50;
    else if (districtKeyLoose && mdl === districtKeyLoose) score += 30;
    if (provinceKey      && mp  === provinceKey)     score += 40;
    else if (provinceKeyLoose && mpl === provinceKeyLoose) score += 20;

    return { m, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) return { match: null, meta: { reason: 'no_candidate_for_old_unit' } };

  const second    = scored[1];
  const ambiguous = Boolean(second && second.score === best.score && best.score > 0);
  const confidence =
    best.score >= 160 ? 'high' :
    best.score >= 120 ? 'medium' :
    best.score > 0    ? 'low' : 'none';

  return {
    match: best.m,
    meta: {
      reason: ambiguous ? 'ambiguous_candidate' : 'ok',
      ambiguous,
      confidence,
      score: best.score,
      candidates: scored.slice(0, 10).map(({ m, score }) => ({
        score,
        oldWardName:     m?.old_ward_name,
        oldDistrictName: m?.old_district_name,
        oldProvinceName: m?.old_province_name,
        newWardCode:     m?.new_ward_code,
        newWardName:     m?.new_ward_name,
        newProvinceName: m?.new_province_name,
      })),
    }
  };
};

/**
 * FIX: Pool merge dùng union thay vì `||`.
 *
 * Trước: `byWard.get(w) || byWardLoose.get(wl)` — nếu byWard có kết quả
 * (dù ít), byWardLoose KHÔNG được thêm vào để bổ sung candidates.
 *
 * Sau: merge + dedup → đảm bảo không bỏ sót candidate từ loose match.
 */
const buildPool = (wardKey, wardKeyLoose) => {
  const strictList = (wardKey && mappingIndex.byWard.get(wardKey)) ?? [];
  const looseList  = (wardKeyLoose && mappingIndex.byWardLoose.get(wardKeyLoose)) ?? [];

  if (!strictList.length && !looseList.length) return [];
  if (!looseList.length) return strictList;
  if (!strictList.length) return looseList;

  // Merge, dedup bằng reference
  const seen = new Set(strictList);
  return [...strictList, ...looseList.filter(m => !seen.has(m))];
};

/**
 * Core lookup: ward name (+ optional district / province / ward code).
 * Priority:
 *   1. old_ward_code (chính xác tuyệt đối)
 *   2. ward + district + province (exact)
 *   3. ward + district (exact)
 *   4. score-based best effort
 */
const findMapping = (legacyWardName, legacyDistrictName, provinceName, legacyWardCode) => {
  // Most reliable: old ward code
  if (legacyWardCode != null) {
    const byCode = mappingIndex.byOldWardCode.get(String(legacyWardCode));
    if (byCode) return { match: byCode, meta: { reason: 'ok', confidence: 'high', ambiguous: false, by: 'old_ward_code' } };
  }

  const wardKey        = norm(legacyWardName);
  const wardKeyLoose   = normLoose(legacyWardName);
  const districtKey    = norm(legacyDistrictName);
  const districtKeyLoose = normLoose(legacyDistrictName);

  let provinceKey = norm(provinceName);
  if (!provinceKey && legacyDistrictName) {
    provinceKey = inferProvinceKeyFromDistrict(legacyDistrictName) ?? '';
  }
  const provinceKeyLoose = normLoose(provinceName) || normLoose(provinceKey);

  const keys = { wardKey, wardKeyLoose, districtKey, districtKeyLoose, provinceKey, provinceKeyLoose };

  // FIX: use union pool (not short-circuit ||)
  const pool = buildPool(wardKey, wardKeyLoose);
  if (!pool.length) return { match: null, meta: { reason: 'no_candidate_for_old_unit' } };

  // Fast-path: ward + district + province (exact)
  if (wardKey && districtKey && provinceKey) {
    const exact = pool.find(m =>
      norm(m.old_ward_name)     === wardKey &&
      norm(m.old_district_name) === districtKey &&
      norm(m.old_province_name) === provinceKey
    );
    if (exact) return { match: exact, meta: { reason: 'ok', confidence: 'high', ambiguous: false, by: 'ward+district+province' } };
  }

  // Fast-path: ward + district (exact)
  if (wardKey && districtKey) {
    const byDistrict = pool.find(m =>
      norm(m.old_ward_name)     === wardKey &&
      norm(m.old_district_name) === districtKey
    );
    if (byDistrict) return {
      match: byDistrict,
      meta: { reason: 'ok', confidence: provinceKey ? 'high' : 'medium', ambiguous: false, by: 'ward+district' }
    };
  }

  // Best-effort scoring
  return pickBestCandidate(pool, keys);
};

// ─── Response builder ──────────────────────────────────────────────────────

const buildResult = (resolved, detailAddress) => {
  const match = resolved?.match ?? resolved;
  const meta  = resolved?.meta;

  if (!match) return {
    found: false, success: false,
    newWard: null, newProvince: null, fullAddress: null,
    ...(meta ? { meta } : {})
  };

  const parts = [detailAddress, match.new_ward_name, match.new_province_name]
    .map(s => s?.trim()).filter(Boolean);

  return {
    success:         true,
    found:           true,
    newWard:         match.new_ward_name,
    newProvince:     match.new_province_name,
    fullAddress:     parts.join(', '),
    newWardCode:     match.new_ward_code,
    newWardName:     match.new_ward_name,
    newProvinceName: match.new_province_name,
    oldWardCode:     match.old_ward_code,
    oldWardName:     match.old_ward_name,
    oldDistrictName: match.old_district_name,
    oldProvinceName: match.old_province_name,
    ...(meta ? { meta } : {}),
  };
};

// ─── POST /convert ─────────────────────────────────────────────────────────

app.post('/convert', (req, res) => {
  const { legacyWardName, legacyDistrictName, provinceName, detailAddress, legacyWardCode } = req.body ?? {};
  if (!legacyWardName)
    return res.status(400).json({ error: 'legacyWardName là bắt buộc' });

  const resolved = findMapping(legacyWardName, legacyDistrictName, provinceName, legacyWardCode);
  res.json(buildResult(resolved, detailAddress));
});

// ─── POST /convert/batch ───────────────────────────────────────────────────

app.post('/convert/batch', (req, res) => {
  const items = req.body;
  if (!Array.isArray(items))
    return res.status(400).json({ error: 'Body phải là một mảng' });
  if (items.length > 500)
    return res.status(400).json({ error: 'Tối đa 500 item mỗi request' });

  const results = items.map(({ legacyWardName, legacyDistrictName, provinceName, detailAddress, legacyWardCode } = {}) => {
    if (!legacyWardName) return { found: false, error: 'legacyWardName bị thiếu' };
    const resolved = findMapping(legacyWardName, legacyDistrictName, provinceName, legacyWardCode);
    return buildResult(resolved, detailAddress);
  });

  res.json(results);
});

// ─── 404 ───────────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint không tồn tại' });
});

// ─── Start ─────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`✅ Vietnam Address API đang chạy tại http://localhost:${PORT}`);
  console.log(`📊 Đã load: ${provinces.length} tỉnh/thành | ${wards.length} phường/xã | ${wardMappings.length} mappings`);
});