# Province Converter — Hướng dẫn cài đặt

Chuyển đổi tên tỉnh/thành Việt Nam từ **63 tỉnh cũ → 34 tỉnh mới** (Nghị quyết 202/2025/QH15, hiệu lực 01/07/2025).

---

## 1. Chuẩn bị database

### Bước 1 — Import dữ liệu từ repo gốc

```bash
git clone https://github.com/thanglequoc/vietnamese-provinces-database
cd vietnamese-provinces-database/mysql

mysql -u root -p vietnamese_administrative_units < CreateTable_vn_units.sql
mysql -u root -p vietnamese_administrative_units < ImportData_vn_units.sql
```

### Bước 2 — Tạo bảng mapping

```bash
mysql -u root -p vietnamese_administrative_units < 01_create_province_mapping.sql
```

---

## 2. Cài đặt & chạy server

```bash
npm install

# Cấu hình biến môi trường (hoặc chỉnh trực tiếp trong app.js)
export DB_HOST=localhost
export DB_USER=root
export DB_PASSWORD=your_password
export DB_NAME=vietnamese_administrative_units

npm start
# Server chạy tại http://localhost:3000
```

---

## 3. API Endpoints

### Chuyển đổi theo tên

```
GET /api/provinces/convert?name=Hà Giang
```

```json
{
  "success": true,
  "data": {
    "old_code": "02",
    "old_name": "Hà Giang",
    "old_full_name": "Tỉnh Hà Giang",
    "new_code": "08",
    "merged_at": "2025-07-01",
    "decree": "202/2025/QH15",
    "new_name": "Tuyên Quang",
    "new_full_name": "Tỉnh Tuyên Quang",
    "new_name_en": "Tuyen Quang",
    "new_full_name_en": "Tuyen Quang Province",
    "new_code_name": "tuyen_quang"
  }
}
```

### Chuyển đổi theo mã tỉnh cũ

```
GET /api/provinces/convert?code=30
```

### Chuyển hàng loạt

```
POST /api/provinces/convert/batch
Content-Type: application/json

{
  "names": ["Hà Giang", "Bắc Kạn", "Hải Dương", "Hà Nội"]
}
```

```json
{
  "success": true,
  "data": [
    { "input": "Hà Giang",  "result": { "new_name": "Tuyên Quang", ... } },
    { "input": "Bắc Kạn",   "result": { "new_name": "Thái Nguyên", ... } },
    { "input": "Hải Dương",  "result": { "new_name": "Hải Phòng", ... } },
    { "input": "Hà Nội",    "result": { "new_name": "Hà Nội", ... } }
  ]
}
```

### Danh sách 34 tỉnh hiện tại (kèm thông tin sáp nhập)

```
GET /api/provinces/current
```

### Toàn bộ bảng mapping (cache cho frontend)

```
GET /api/provinces/mappings
```

---

## 5. DVHCVN ward/district converter (giảm ambiguous)

Repo có kèm converter để map **phường/xã** theo dữ liệu DVHCVN trong DB `vietnamese_administrative_units`.

### Convert ward (phường/xã) theo input legacy

```
POST /api/dvhcvn/convert/ward
Content-Type: application/json

{
  "legacyWardName": "Phường 6",
  "legacyDistrictName": "Quận Gò Vấp",
  "legacyProvinceName": "TP Hồ Chí Minh",
  "detailAddress": "496/9/4 Dương Quảng Hàm, Gò Vấp, TP.HCM"
}
```

- Nếu **match được 1 kết quả** → `success: true`
- Nếu **nhiều ứng viên** → HTTP `409` + `reason: "ambiguous_candidate"` + danh sách candidates (tối đa 50) để debug
- Nếu **không tìm thấy** → HTTP `404`

### Replay file failures để đo cải thiện

```
node scripts/replay-dvhcvn-failures.js dvhcvn-convert-failures.json
```

### Auto-resolve một phần failures (khi chỉ có 1 candidate đúng tỉnh)

Script này đọc `dvhcvn-convert-failures.json` và **tự chọn candidate** nếu suy ra được tỉnh (từ `legacyDistrictName` hoặc `detailAddress`) và trong `candidateWards` **chỉ có đúng 1 ward thuộc tỉnh đó**.

```
node scripts/resolve-dvhcvn-failures.js dvhcvn-convert-failures.json dvhcvn-convert-resolved.json
```

Kết quả ghi ra file `dvhcvn-convert-resolved.json` gồm `stats` và danh sách `resolved`.

---

## 4. Dùng trực tiếp không qua HTTP (embed vào service khác)

```js
const ProvinceConverterService = require('./src/ProvinceConverterService');

const svc = new ProvinceConverterService({
  host: 'localhost', user: 'root',
  password: 'pass', database: 'vietnamese_administrative_units'
});

// Chuyển theo tên
const result = await svc.convertByName('Hải Dương');
console.log(result.new_name); // "Hải Phòng"

// Chuyển hàng loạt
const batch = await svc.convertBatch(['Bến Tre', 'Trà Vinh', 'Bạc Liêu']);
// → [{input:'Bến Tre', result:{new_name:'Vĩnh Long'}}, ...]

await svc.close();
```
