(async () => {
  console.log('B?t d?u g?i /api/dry-run ...');
  try {
    const res = await fetch('http://localhost:3000/api/dry-run', { method: 'POST' });
    const data = await res.json();
    console.log('Thành công! D? li?u tr? v?:');
    console.log(JSON.stringify(data, null, 2));
  } catch(e) {
    console.log('L?i:', e.message);
  }
})();
