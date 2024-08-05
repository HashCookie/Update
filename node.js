import express from 'express';
import multer from 'multer';
import { Octokit } from "@octokit/rest";
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const app = express();
const upload = multer({ dest: 'uploads/' });

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const fileContent = fs.readFileSync(file.path, 'utf8');

    // 修改这里：将文件路径设置为 'upload' 目录下
    const githubFilePath = path.join('upload', file.originalname);

    await octokit.repos.createOrUpdateFileContents({
      owner: 'HashCookie',
      repo: 'Update',
      path: githubFilePath,  // 使用新的文件路径
      message: 'File uploaded via web app',
      content: Buffer.from(fileContent).toString('base64'),
      branch: 'main'
    });

    res.send('File uploaded and committed to GitHub in the upload folder');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error uploading file to GitHub');
  }
});

app.listen(3000, () => console.log('Server running on port 3000'));