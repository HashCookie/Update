import { Octokit } from "@octokit/rest";
import multer from "multer";
import fs from "fs";
import dotenv from "dotenv";
import path from "path";
import * as XLSX from 'xlsx';

dotenv.config();

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const upload = multer({
  dest: "/tmp/uploads",
  limits: { fileSize: MAX_FILE_SIZE }
});

const octokit = new Octokit({ auth: process.env.GH_TOKEN });

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

// 从字典中获取翻译
async function getTranslationsFromDictionary(letter) {
  try {
    const dictionaryPath = `split_dictionary/dictionary_${letter}.json`;
    const { data } = await octokit.repos.getContent({
      owner: "HashCookie",
      repo: "Update",
      path: dictionaryPath,
      ref: "main",
    });
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    const dictionary = JSON.parse(content);
    console.log(`Dictionary for letter '${letter}' loaded successfully. Sample entries:`, dictionary.slice(0, 5));
    // 将字典转换为以 name 为键的对象，同时转换为小写
    return dictionary.reduce((acc, item) => {
      acc[item.name.toLowerCase()] = item;
      return acc;
    }, {});
  } catch (error) {
    console.error(`Error fetching dictionary for letter '${letter}':`, error);
    console.error("Error details:", error.message);
    return {};
  }
}

// 转换文件内容为所需的 JSON 格式
async function convertToRequiredFormat(fileContent, fileType) {
  let words;

  if (fileType === 'txt') {
    const content = fileContent.toString('utf-8');
    words = content.split('\n').filter(word => word.trim() !== '');
  } else if (fileType === 'xlsx') {
    const workbook = XLSX.read(fileContent, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    words = XLSX.utils.sheet_to_json(sheet, { header: 1 }).flat().filter(word => word && word.trim() !== '');
  } else if (fileType === 'json') {
    return JSON.parse(fileContent.toString('utf-8'));
  }

  console.log("Words to process:", words);

  const result = [];
  for (const word of words) {
    const trimmedWord = word.trim().toLowerCase();
    console.log(`Processing word: "${trimmedWord}"`);
    const firstLetter = trimmedWord[0];
    const letterDictionary = await getTranslationsFromDictionary(firstLetter);
    const dictEntry = letterDictionary[trimmedWord];
    if (dictEntry) {
      console.log(`Translation found for "${trimmedWord}":`, dictEntry);
      result.push({
        name: trimmedWord,
        trans: dictEntry.trans,
        usphone: dictEntry.usphone || "",
        ukphone: dictEntry.ukphone || ""
      });
    } else {
      console.log(`No translation found for "${trimmedWord}"`);
      result.push({
        name: trimmedWord,
        trans: ["未在字典中找到翻译"],
        usphone: "",
        ukphone: ""
      });
    }
  }

  return result;
}

async function appendToExistingFile(newContent) {
  const githubFilePath = "upload/example.json";
  let existingContent = [];
  let sha;

  try {
    // 尝试获取现有文件内容
    const { data: existingFile } = await octokit.repos.getContent({
      owner: "HashCookie",
      repo: "Update",
      path: githubFilePath,
      ref: "main",
    });
    sha = existingFile.sha;
    const decodedContent = Buffer.from(existingFile.content, 'base64').toString('utf-8');
    existingContent = JSON.parse(decodedContent);
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
    // 如果文件不存在，我们将创建一个新文件
    console.log("File does not exist, will create a new one");
  }

  // 合并现有内容和新内容
  const updatedContent = [...existingContent, ...newContent];

  // 去重
  const uniqueContent = Array.from(new Set(updatedContent.map(JSON.stringify))).map(JSON.parse);

  // 按名称排序
  uniqueContent.sort((a, b) => a.name.localeCompare(b.name));

  // 上传更新后的内容
  await octokit.repos.createOrUpdateFileContents({
    owner: "HashCookie",
    repo: "Update",
    path: githubFilePath,
    message: "Update dictionary with new words",
    content: Buffer.from(JSON.stringify(uniqueContent, null, 2)).toString("base64"),
    sha: sha,
    branch: "main",
  });

  return uniqueContent;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  upload.single("file")(req, res, async (err) => {
    try {
      if (err) {
        console.error("File upload error:", err);
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ success: false, message: "文件大小超过限制（5MB）" });
          }
          return res.status(400).json({ success: false, message: "文件上传错误", error: err.message });
        }
        return res.status(500).json({ success: false, message: "文件上传失败", error: err.message });
      }

      console.log("Received upload request");
      const file = req.file;
      if (!file) {
        console.log("No file uploaded");
        return res.status(400).json({ success: false, message: "没有文件被上传" });
      }

      console.log("File received:", file.originalname);
      const fileContent = fs.readFileSync(file.path);
      const fileExtension = path.extname(file.originalname).toLowerCase();

      console.log(`File extension: ${fileExtension}`);
      let jsonContent;
      if (fileExtension === '.txt' || fileExtension === '.xlsx' || fileExtension === '.json') {
        console.log(`Processing ${fileExtension.substr(1)} file`);
        jsonContent = await convertToRequiredFormat(fileContent, fileExtension.substr(1));
      } else {
        console.log("Unsupported file format");
        return res.status(400).json({
          success: false,
          message: "不支持的文件格式，请上传 .txt, .xlsx 或 .json 文件",
        });
      }

      console.log("Converted content:", JSON.stringify(jsonContent, null, 2));

      // 验证转换后的 JSON 格式
      if (!validateJsonFormat(JSON.stringify(jsonContent))) {
        return res.status(400).json({
          success: false,
          message: "转换后的文件格式不正确",
        });
      }

      // 追加到现有文件
      const updatedContent = await appendToExistingFile(jsonContent);
      console.log("File updated on GitHub successfully");

      res.status(200).json({
        success: true,
        message: "新单词已成功追加到GitHub的upload/example.json文件中",
        totalWords: updatedContent.length
      });
    } catch (error) {
      console.error("Error processing file:", error);
      console.error("Error stack:", error.stack);
      res.status(500).json({
        success: false,
        message: "处理文件或上传到GitHub时发生错误",
        error: error.message,
        stack: error.stack
      });
    } finally {
      // 确保在所有情况下都删除临时文件
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (unlinkError) {
          console.error("Error deleting temporary file:", unlinkError);
        }
      }
    }
  });
}