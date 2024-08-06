import express from 'express';
import multer from 'multer';
import { Octokit } from "@octokit/rest";
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';
import cors from 'cors';

dotenv.config();

const app = express();
app.use(cors());
const upload = multer({ dest: 'uploads/' });

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

app.post('/upload', upload.single('file'), async (req, res) => {
  console.log('Received upload request');
  try {
    const file = req.file;
    if (!file) {
      console.log('No file uploaded');
      return res.status(400).json({ success: false, message: '没有文件被上传' });
    }

    console.log('File received:', file.originalname);
    const fileContent = fs.readFileSync(file.path, 'utf8');
    const githubFilePath = path.join('upload', file.originalname);

    let sha;
    try {
      const { data: existingFile } = await octokit.repos.getContent({
        owner: 'HashCookie',
        repo: 'Update',
        path: githubFilePath,
        ref: 'main'
      });
      sha = existingFile.sha;
      console.log('Existing file SHA:', sha);
    } catch (error) {
      if (error.status === 404) {
        console.log('File does not exist, will create a new one');
      } else {
        console.error('Error checking existing file:', error);
        return res.status(500).json({ success: false, message: '检查文件是否存在时发生错误', error: error.message });
      }
    }

    console.log('Uploading to GitHub...');
    await octokit.repos.createOrUpdateFileContents({
      owner: 'HashCookie',
      repo: 'Update',
      path: githubFilePath,
      message: 'File uploaded via web app',
      content: Buffer.from(fileContent).toString('base64'),
      sha: sha, 
      branch: 'main'
    });

    console.log('File uploaded to GitHub successfully');

    fs.unlinkSync(file.path);

    console.log('Sending success response');
    res.status(200).json({ success: true, message: '文件已成功上传并提交到GitHub的upload文件夹' });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, message: '上传文件到GitHub时发生错误', error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
