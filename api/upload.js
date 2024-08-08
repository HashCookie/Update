import { Octokit } from "@octokit/rest";
import multer from "multer";
import fs from "fs";
import dotenv from "dotenv";
import path from "path";
import xlsx from "xlsx";

dotenv.config();

const upload = multer({ dest: "/tmp/uploads" });

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// 验证 JSON 格式的函数
function validateJsonFormat(jsonContent) {
  try {
    const data = JSON.parse(jsonContent);
    if (!Array.isArray(data)) {
      return false;
    }
    return data.every(item => 
      typeof item === 'object' &&
      typeof item.name === 'string' &&
      Array.isArray(item.trans) &&
      item.trans.every(trans => typeof trans === 'string')
    );
  } catch (error) {
    return false;
  }
}

// 修改：从字典中获取翻译
async function getTranslationsFromDictionary() {
  try {
    const { data } = await octokit.repos.getContent({
      owner: "HashCookie",
      repo: "Update",
      path: "dictionary.json",
      ref: "main",
    });
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    const dictionary = JSON.parse(content);
    // 将字典转换为以 name 为键的对象
    return dictionary.reduce((acc, item) => {
      acc[item.name] = item;
      return acc;
    }, {});
  } catch (error) {
    console.error("Error fetching dictionary:", error);
    return {};
  }
}

// 修改：转换文件内容为所需的 JSON 格式
async function convertToRequiredFormat(fileContent, fileType) {
  const dictionary = await getTranslationsFromDictionary();
  let words;

  if (fileType === 'txt') {
    words = fileContent.split('\n').filter(word => word.trim() !== '');
  } else if (fileType === 'xlsx') {
    const workbook = xlsx.read(fileContent, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    words = xlsx.utils.sheet_to_json(sheet, { header: 1 }).flat().filter(word => word && word.trim() !== '');
  } else {
    return JSON.parse(fileContent);
  }

  return words.map(word => {
    const trimmedWord = word.trim();
    const dictEntry = dictionary[trimmedWord];
    if (dictEntry) {
      return {
        name: trimmedWord,
        trans: dictEntry.trans,
        usphone: dictEntry.usphone || "",
        ukphone: dictEntry.ukphone || ""
      };
    } else {
      return {
        name: trimmedWord,
        trans: ["未在字典中找到翻译"],
        usphone: "",
        ukphone: ""
      };
    }
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  upload.single("file")(req, res, async (err) => {
    if (err) {
      return res.status(500).json({ message: "File upload failed" });
    }

    console.log("Received upload request");
    try {
      const file = req.file;
      if (!file) {
        console.log("No file uploaded");
        return res
          .status(400)
          .json({ success: false, message: "没有文件被上传" });
      }

      console.log("File received:", file.originalname);
      const fileContent = fs.readFileSync(file.path);
      const fileExtension = path.extname(file.originalname).toLowerCase();

      let jsonContent;
      if (fileExtension === '.txt') {
        jsonContent = await convertToRequiredFormat(fileContent.toString(), 'txt');
      } else if (fileExtension === '.xlsx') {
        jsonContent = await convertToRequiredFormat(fileContent, 'xlsx');
      } else if (fileExtension === '.json') {
        jsonContent = await convertToRequiredFormat(fileContent.toString(), 'json');
      } else {
        return res.status(400).json({
          success: false,
          message: "不支持的文件格式��请上传 .txt, .xlsx 或 .json 文件",
        });
      }

      // 验证转换后的 JSON 格式
      if (!validateJsonFormat(JSON.stringify(jsonContent))) {
        return res.status(400).json({
          success: false,
          message: "转换后的文件格式不正确",
        });
      }

      // 修改这里：使用固定的文件名 'example.json'
      const githubFilePath = "upload/example.json";

      let sha;
      try {
        const { data: existingFile } = await octokit.repos.getContent({
          owner: "HashCookie",
          repo: "Update",
          path: githubFilePath,
          ref: "main",
        });
        sha = existingFile.sha;
        console.log("Existing file SHA:", sha);
      } catch (error) {
        if (error.status === 404) {
          console.log("File does not exist, will create a new one");
        } else {
          console.error("Error checking existing file:", error);
          return res.status(500).json({
            success: false,
            message: "检查文件是否存在时发生错误",
            error: error.message,
          });
        }
      }

      console.log("Uploading to GitHub...");
      await octokit.repos.createOrUpdateFileContents({
        owner: "HashCookie",
        repo: "Update",
        path: githubFilePath,
        message: "File uploaded and converted via web app",
        content: Buffer.from(JSON.stringify(jsonContent, null, 2)).toString("base64"),
        sha: sha,
        branch: "main",
      });

      console.log("File uploaded to GitHub successfully");

      fs.unlinkSync(file.path);

      console.log("Sending success response");
      res.status(200).json({
        success: true,
        message: "文件已成功转换、上传并提交到GitHub的upload文件夹",
      });
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({
        success: false,
        message: "处理文件或上传到GitHub时发生错误",
        error: error.message,
      });
    }
  });
}