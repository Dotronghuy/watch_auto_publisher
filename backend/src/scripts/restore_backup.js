import { restoreBackup, listBackups, BACKUP_NAME_PATTERN } from '../services/backup.service.js';

const name = process.argv[2] || '';

const main = async () => {
  if (!BACKUP_NAME_PATTERN.test(name)) {
    console.log('Cách dùng: node src/scripts/restore_backup.js backup_YYYY-MM-DD_HH-MM-SS');
    console.log('\nCác bản backup hiện có:');
    for (const b of listBackups()) {
      console.log(`  ${b.name} — ${b.fileCount} file, ${(b.totalBytes / 1024).toFixed(0)} KB — ${new Date(b.createdAt).toLocaleString('vi-VN')}`);
    }
    process.exit(1);
  }

  try {
    const result = await restoreBackup(name);
    console.log(`✅ Đã khôi phục ${result.restored.length} file từ ${name}:`);
    for (const rel of result.restored) console.log(`  + ${rel}`);
    if (result.failed.length > 0) {
      console.warn('⚠️ Không khôi phục được:');
      for (const f of result.failed) console.warn(`  - ${f.file}: ${f.error}`);
    }
    console.log('\n👉 Giờ bạn có thể khởi động lại hệ thống bình thường.');
  } catch (e) {
    console.error('❌', e.message);
    process.exit(1);
  }
};

main();
