import express from 'express';
import { generateBannersForModels } from '../controllers/banner.controller.js';
import multer from 'multer';
import path from 'path';

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'assets/banner_template/');
  },
  filename: function (req, file, cb) {
    cb(null, 'Background.jpg');
  }
});
const upload = multer({ storage });

const router = express.Router();

router.post('/generate-collection', generateBannersForModels);
router.post('/upload-template', upload.single('file'), (req, res) => {
  res.json({ success: true, message: 'Đã cập nhật Background' });
});

export default router;
