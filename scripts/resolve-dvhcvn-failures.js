/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

function normalizeKey(input) {
  if (!input) return null;
  return String(input)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['".,()/\\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripAdminPrefix(nameKey) {
  if (!nameKey) return null;
  return nameKey
    .replace(/^(phuong|xa|thi tran|thon|ap|khu pho)\s+/g, '')
    .trim();
}

function includesWord(haystackKey, needleKey) {
  if (!haystackKey || !needleKey) return false;
  const h = ` ${haystackKey} `;
  const n = ` ${needleKey} `;
  return h.includes(n);
}

function inferProvinceKey({ legacyDistrictName, detailAddress }) {
  const districtKey = normalizeKey(legacyDistrictName);
  const addressKey = normalizeKey(detailAddress);

  const hcm = new Set([
    'quan 1','quan 2','quan 3','quan 4','quan 5','quan 6','quan 7','quan 8','quan 9','quan 10','quan 11','quan 12',
    'quan binh tan','quan binh thanh','quan go vap','quan phu nhuan','quan tan binh','quan tan phu','quan thu duc',
    'huyen binh chanh','huyen can gio','huyen cu chi','huyen hoc mon','huyen nha be',
  ]);
  const hn = new Set([
    'quan ba dinh','quan bac tu liem','quan cau giay','quan dong da','quan ha dong','quan hai ba trung',
    'quan hoan kiem','quan hoang mai','quan long bien','quan nam tu liem','quan tay ho','quan thanh xuan',
  ]);
  const dn = new Set(['quan hai chau','quan thanh khe','quan son tra','quan ngu hanh son','quan lien chieu']);

  if (districtKey && hcm.has(districtKey)) return 'thanh pho ho chi minh';
  if (districtKey && hn.has(districtKey)) return 'thanh pho ha noi';
  if (districtKey && dn.has(districtKey)) return 'thanh pho da nang';

  if (addressKey) {
    if (/(^|\s)(tp\s*hcm|tphcm|ho chi minh|sai gon)(\s|$)/.test(addressKey)) return 'thanh pho ho chi minh';
    if (/(^|\s)(ha noi)(\s|$)/.test(addressKey)) return 'thanh pho ha noi';
    if (/(^|\s)(da nang)(\s|$)/.test(addressKey)) return 'thanh pho da nang';
    if (/(^|\s)(hai phong)(\s|$)/.test(addressKey)) return 'thanh pho hai phong';
    if (/(^|\s)(can tho)(\s|$)/.test(addressKey)) return 'thanh pho can tho';
  }

  return null;
}

function pickUniqueCandidateHcmOnly({ candidates, legacyWardName }) {
  const wardKey = stripAdminPrefix(normalizeKey(legacyWardName));
  const inHcm = candidates.filter(c => normalizeKey(c.province) === 'thanh pho ho chi minh');

  // If HCM-only dataset, first reduce to HCM candidates.
  if (!inHcm.length) return null;

  // Strong guardrail: only keep candidates whose ward name matches the input wardKey.
  // This prevents wrong picks like "Phú Trung" => "Tân Phú" just because it's unique in HCM.
  const matchingWard = wardKey
    ? inHcm.filter(c => includesWord(stripAdminPrefix(normalizeKey(c.ward)), wardKey))
    : inHcm;

  if (matchingWard.length === 1) return matchingWard[0];

  // Fallback: if wardKey is a number (e.g. "6") try exact end-match on "phuong 6" style.
  if (wardKey && /^\d+$/.test(wardKey)) {
    const exactNumber = inHcm.filter(c => {
      const wk = stripAdminPrefix(normalizeKey(c.ward));
      return wk === wardKey;
    });
    if (exactNumber.length === 1) return exactNumber[0];
  }

  return null;
}

function pickBestEffortHcm({ candidates, legacyWardName }) {
  const wardKey = stripAdminPrefix(normalizeKey(legacyWardName));
  const inHcm = candidates.filter(c => normalizeKey(c.province) === 'thanh pho ho chi minh');
  if (!inHcm.length) return null;

  const matchingWard = wardKey
    ? inHcm.filter(c => includesWord(stripAdminPrefix(normalizeKey(c.ward)), wardKey))
    : inHcm;

  const pool = matchingWard.length ? matchingWard : inHcm;

  // Deterministic tie-break: smallest wardCode.
  const sorted = [...pool].sort((a, b) => String(a.wardCode).localeCompare(String(b.wardCode)));
  return {
    chosen: sorted[0],
    confidence:
      matchingWard.length === 1 ? 'high' :
      matchingWard.length > 1 ? 'low' :
      'very_low',
    tieBreak:
      matchingWard.length === 1 ? 'unique_hcm_ward_match' :
      matchingWard.length > 1 ? 'min_wardCode_among_hcm_ward_matches' :
      'min_wardCode_among_hcm_candidates',
    candidateCount: pool.length,
  };
}

async function main() {
  const failuresPath = process.argv[2] || path.join(process.cwd(), 'dvhcvn-convert-failures.json');
  const outPath = process.argv[3] || path.join(process.cwd(), 'dvhcvn-convert-resolved.json');

  const items = JSON.parse(fs.readFileSync(failuresPath, 'utf8'));
  const resolved = [];

  const stats = {
    total: 0,
    ambiguous: 0,
    resolved: 0, // high-confidence only
    forced_resolved: 0, // includes low confidence
    unresolved: 0, // no HCM candidates
    missing_candidates: 0,
    confidence: { high: 0, low: 0, very_low: 0 },
  };

  for (const it of items) {
    stats.total += 1;
    if (!it || it.reason !== 'ambiguous_candidate') continue;
    stats.ambiguous += 1;

    const payload = it.payload || {};
    const candidates = (it.debug && it.debug.candidateWards) || [];
    if (!candidates.length) {
      stats.missing_candidates += 1;
      continue;
    }

    // User says dataset is HCM-only, so default inferred province to HCM.
    const provinceKey = 'thanh pho ho chi minh';
    const unique = pickUniqueCandidateHcmOnly({ candidates, legacyWardName: payload.legacyWardName });
    const bestEffort = pickBestEffortHcm({ candidates, legacyWardName: payload.legacyWardName });

    if (unique) {
      stats.resolved += 1;
      stats.forced_resolved += 1;
      stats.confidence.high += 1;
      resolved.push({
        input: payload,
        inferredProvince: provinceKey,
        chosen: unique,
        confidence: 'high',
        tieBreak: 'unique_hcm_ward_match',
      });
      continue;
    }

    if (bestEffort) {
      stats.forced_resolved += 1;
      stats.confidence[bestEffort.confidence] += 1;
      resolved.push({
        input: payload,
        inferredProvince: provinceKey,
        chosen: bestEffort.chosen,
        confidence: bestEffort.confidence,
        tieBreak: bestEffort.tieBreak,
        candidateCount: bestEffort.candidateCount,
      });
    } else {
      stats.unresolved += 1;
    }
  }

  fs.writeFileSync(outPath, JSON.stringify({ stats, resolved }, null, 2), 'utf8');
  console.log(JSON.stringify({ outPath, stats, resolvedPreview: resolved.slice(0, 3) }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

