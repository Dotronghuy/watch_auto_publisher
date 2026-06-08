import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const usersFilePath = path.join(__dirname, '../../users.json');

export const readUsers = () => {
  if (!fs.existsSync(usersFilePath)) return [];
  const data = fs.readFileSync(usersFilePath, 'utf8');
  try {
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
};

export const writeUsers = (users) => {
  fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
};

export const getUserById = (id) => {
  const users = readUsers();
  return users.find(u => u.id === id);
};

export const getUserByUsername = (username) => {
  const users = readUsers();
  return users.find(u => u.username === username);
};
