import fs from 'fs';

const stripJsonBom = (text) => String(text || '').replace(/^\uFEFF/, '');

export const readJsonFileSync = (filePath) => (
  JSON.parse(stripJsonBom(fs.readFileSync(filePath, 'utf8')))
);

export const writeJsonFileSync = (filePath, data) => {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
};
