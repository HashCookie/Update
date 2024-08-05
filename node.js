import express from 'express';
import multer from 'multer';
import { Octokit } from "@octokit/rest";
import fs from 'fs';

const app = express();
const upload = multer({ dest: 'uploads/' });

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const fileContent = fs.readFileSync(file.path, 'utf8');

    await octokit.repos.createOrUpdateFileContents({
      owner: 'HashCookie',
      repo: 'UserUpload',
      path: file.originalname,
      message: 'File uploaded via web app',
      content: Buffer.from(fileContent).toString('base64'),
      branch: 'master'
    });

    res.send('File uploaded and committed to GitHub');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error uploading file to GitHub');
  }
});

app.listen(3000, () => console.log('Server running on port 3000'));