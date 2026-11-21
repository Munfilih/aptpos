
# aptPOS Android Port

## Objective
Build a full Android POS application while preserving the existing aptPOS React interface and business features.

The Windows Electron application on main must remain unchanged.

## Existing Technology
- React 19
- TypeScript
- Vite
- Electron 33
- Express backend
- SQLite using sql.js

## Android Requirements

### 1. User Interface
- Preserve existing POS design.
- Support Android phones and tablets.
- Maintain existing workflows.

### 2. Offline Database
- Native Android SQLite integration.
- Offline sales and inventory.
- Reliable invoice numbering.
- Backup and restore.

### 3. POS Features
- Product management
- Barcode scanning
- Sales and payments
- Sales history
- Purchases
- Customers and vendors
- Inventory
- Cashbook
- Reports
- Returns

### 4. Thermal Printing
- Bluetooth ESC/POS printing
- USB ESC/POS printing
- 58mm and 80mm receipt layouts
- Arabic and English text
- QR codes and barcodes

### 5. Android Integration
- Capacitor Android project
- Native Android permissions
- File access
- Backup and restore
- Printer connectivity

### 6. Cloud Build
- GitHub Actions
- Android APK generation
- Debug APK artifact
- Release APK signing

## Development Milestones

- [ ] Audit existing application architecture.
- [ ] Create Android project.
- [ ] Implement Android SQLite adapter.
- [ ] Migrate backend API functionality.
- [ ] Implement Bluetooth printer support.
- [ ] Implement USB printer support.
- [ ] Integrate Android permissions.
- [ ] Configure GitHub Actions.
- [ ] Build APK.
- [ ] Test all POS features offline.
- [ ] Test on physical Android devices.

## Important
Do not replace the existing Windows application.
Do not create a web-only APK wrapper as the final product.
Preserve existing functionality wherever possible.
