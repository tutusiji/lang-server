const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');

const LANGUAGES_DIR = path.join(__dirname, '../../data/languages');
const LANGUAGE_LIST_FILE = path.join(__dirname, '../../data/language-list.json');
const DOWNLOADS_DIR = path.join(__dirname, '../../downloads');

// 确保下载目录存在
fs.ensureDirSync(DOWNLOADS_DIR);

// i18n 路由
async function i18nRoutes(fastify, options) {

  // 前缀内健康检查 /api/i18n/health
  fastify.get('/health', async () => ({ status: 'ok' }));

  // 语言文件管理API



  // 检查版本更新
  fastify.post('/version/check', async (request, reply) => {
    try {
      const { clientVersion } = request.body;
      const languageList = await fs.readJson(LANGUAGE_LIST_FILE);
      
      const needsUpdate = compareVersions(languageList.version, clientVersion || '0.0.0') > 0;
      
      return {
        success: true,
        data: {
          needsUpdate,
          clientVersion: clientVersion || '0.0.0',
          serverVersion: languageList.version,
          lastUpdated: languageList.lastUpdated
        }
      };
    } catch (error) {
      fastify.log.error('Error checking version:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to check version',
        message: error.message
      });
    }
  });

  // 获取支持的语言列表
  fastify.get('/languages', async (request, reply) => {
    try {
      const languageList = await fs.readJson(LANGUAGE_LIST_FILE);
      reply.header('Cache-Control', 'public, max-age=30');
      return {
        success: true,
        data: languageList
      };
    } catch (error) {
      fastify.log.error('Error reading language list:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to read language list',
        message: error.message
      });
    }
  });

  // 获取指定语言的翻译文件
  fastify.get('/language/:code', async (request, reply) => {
    try {
      const { code } = request.params;
      const filePath = path.join(LANGUAGES_DIR, `${code}.json`);
      
      // 检查文件是否存在
      if (!await fs.pathExists(filePath)) {
        return reply.status(404).send({
          success: false,
          error: 'Language file not found',
          code: code
        });
      }

      const translations = await fs.readJson(filePath);
      // 直接返回翻译内容，不包装额外的结构
      return {
        success: true,
        data: translations
      };
    } catch (error) {
      fastify.log.error(`Error reading language file for ${request.params.code}:`, error);
      reply.status(500).send({
        success: false,
        error: 'Failed to read language file',
        message: error.message
      });
    }
  });

  // 批量获取多个语言文件
  fastify.post('/languages/batch', async (request, reply) => {
    try {
      const { codes } = request.body;
      
      if (!Array.isArray(codes)) {
        return reply.status(400).send({
          success: false,
          error: 'codes must be an array'
        });
      }

      const results = {};
      const errors = [];

      for (const code of codes) {
        try {
          const filePath = path.join(LANGUAGES_DIR, `${code}.json`);
          
          if (await fs.pathExists(filePath)) {
            const translations = await fs.readJson(filePath);
            results[code] = translations;
          } else {
            errors.push({ code, error: 'File not found' });
          }
        } catch (error) {
          errors.push({ code, error: error.message });
        }
      }

      return {
        success: true,
        data: results,
        errors: errors.length > 0 ? errors : undefined
      };
    } catch (error) {
      fastify.log.error('Error in batch language fetch:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to fetch language files',
        message: error.message
      });
    }
  });

  // 新：聚合接口：返回已启用语言的 messages 映射（减少前端批量请求次数，可通过 ?includeDisabled=true 覆盖）
  fastify.get('/languages/enabled-messages', async (request, reply) => {
    try {
      const includeDisabled = request.query.includeDisabled === 'true';
      const languageList = await fs.readJson(LANGUAGE_LIST_FILE);
      const target = includeDisabled ? languageList.languages : languageList.languages.filter(l => l.enabled);
      const result = {};
      for (const lang of target) {
        const filePath = path.join(LANGUAGES_DIR, `${lang.code}.json`);
        if (await fs.pathExists(filePath)) {
          result[lang.code] = await fs.readJson(filePath);
        }
      }
      reply.header('Cache-Control', 'public, max-age=30');
      return { success: true, data: { config: languageList, messages: result } };
    } catch (error) {
      fastify.log.error('Error reading enabled messages:', error);
      reply.status(500).send({ success: false, error: 'Failed to read enabled messages', message: error.message });
    }
  });

  // 合并接口：获取完整的i18n数据（语言列表 + 翻译内容 + 版本信息）
  fastify.get('/data/complete', async (request, reply) => {
    try {
      const includeDisabled = request.query.includeDisabled === 'true';
      
      // 读取语言列表（包含版本信息）
      const languageList = await fs.readJson(LANGUAGE_LIST_FILE);
      
      // 筛选启用的语言
      const target = includeDisabled ? languageList.languages : languageList.languages.filter(l => l.enabled);
      
      // 读取对应的翻译文件
      const messages = {};
      for (const lang of target) {
        const filePath = path.join(LANGUAGES_DIR, `${lang.code}.json`);
        if (await fs.pathExists(filePath)) {
          messages[lang.code] = await fs.readJson(filePath);
        }
      }
      
      reply.header('Cache-Control', 'public, max-age=300'); // 5分钟缓存
      return {
        success: true,
        version: languageList.version,
        lastUpdated: languageList.lastUpdated,
        languages: languageList.languages,
        messages: messages,
        defaultLanguage: languageList.defaultLanguage,
        fallbackLanguage: languageList.fallbackLanguage
      };
    } catch (error) {
      fastify.log.error('Error reading complete i18n data:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to read complete i18n data',
        message: error.message
      });
    }
  });

  // 更新语言列表配置
  fastify.post('/languages/update', async (request, reply) => {
    try {
      const { languages, defaultLanguage, fallbackLanguage } = request.body;
      
      // 验证必需字段
      if (!Array.isArray(languages)) {
        return reply.status(400).send({
          success: false,
          error: 'languages must be an array'
        });
      }

      const newConfig = {
        languages,
        defaultLanguage: defaultLanguage || 'zh-CN',
        fallbackLanguage: fallbackLanguage || 'zh-CN'
      };

      await fs.writeJson(LANGUAGE_LIST_FILE, newConfig, { spaces: 2 });
      
      // 自动递增版本号
      await incrementVersion();

      return {
        success: true,
        message: 'Language configuration updated successfully',
        data: newConfig
      };
    } catch (error) {
      fastify.log.error('Error updating language configuration:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to update language configuration',
        message: error.message
      });
    }
  });

  // 更新指定语言的翻译文件
  fastify.post('/language/:code/update', async (request, reply) => {
    try {
      const { code } = request.params;
      const { translations } = request.body;
      
      if (!translations || typeof translations !== 'object') {
        return reply.status(400).send({
          success: false,
          error: 'translations must be a valid object'
        });
      }

      const filePath = path.join(LANGUAGES_DIR, `${code}.json`);
      // 直接保存翻译内容，不包装额外的结构
      await fs.writeJson(filePath, translations, { spaces: 2 });
      
      // 自动递增版本号
      await incrementVersion();

      return {
        success: true,
        message: `Language file for ${code} updated successfully`,
        data: {
          code,
          translations
        }
      };
    } catch (error) {
      fastify.log.error(`Error updating language file for ${request.params.code}:`, error);
      reply.status(500).send({
        success: false,
        error: 'Failed to update language file',
        message: error.message
      });
    }
  });

  // 部分更新语言文件中的指定key
  fastify.post('/language/:code/update-key', async (request, reply) => {
    try {
      const { code } = request.params;
      const { key, value } = request.body;
      
      if (!key || typeof key !== 'string') {
        return reply.status(400).send({
          success: false,
          error: 'key must be a valid string'
        });
      }

      const filePath = path.join(LANGUAGES_DIR, `${code}.json`);
      
      // 检查文件是否存在
      if (!(await fs.pathExists(filePath))) {
        return reply.status(404).send({
          success: false,
          error: `Language file for ${code} not found`
        });
      }

      // 读取现有翻译文件
      const translations = await fs.readJson(filePath);
      
      // 设置嵌套key的值
      const keys = key.split('.');
      let current = translations;
      
      // 遍历到倒数第二个key，确保路径存在
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        if (!current[k] || typeof current[k] !== 'object') {
          current[k] = {};
        }
        current = current[k];
      }
      
      // 设置最后一个key的值
      const lastKey = keys[keys.length - 1];
      current[lastKey] = value || '';

      // 保存更新后的文件
      await fs.writeJson(filePath, translations, { spaces: 2 });
      
      // 自动递增版本号
      await incrementVersion();

      return {
        success: true,
        message: `Key '${key}' updated successfully in ${code}`,
        data: {
          code,
          key,
          value
        }
      };
    } catch (error) {
      fastify.log.error(`Error updating key in language file for ${request.params.code}:`, error);
      reply.status(500).send({
        success: false,
        error: 'Failed to update language key',
        message: error.message
      });
    }
  });

  // 批量更新多个语言的指定key
  fastify.post('/languages/update-key-batch', async (request, reply) => {
    try {
      const { key, translations } = request.body;
      
      if (!key || typeof key !== 'string') {
        return reply.status(400).send({
          success: false,
          error: 'key must be a valid string'
        });
      }
      
      if (!translations || typeof translations !== 'object') {
        return reply.status(400).send({
          success: false,
          error: 'translations must be an object'
        });
      }

      const results = [];
      const errors = [];

      // 批量更新每个语言
      for (const [languageCode, value] of Object.entries(translations)) {
        try {
          const filePath = path.join(LANGUAGES_DIR, `${languageCode}.json`);
          
          // 检查文件是否存在，如果不存在则创建
          let languageTranslations = {};
          if (await fs.pathExists(filePath)) {
            languageTranslations = await fs.readJson(filePath);
          }
          
          // 设置嵌套key的值
          const keys = key.split('.');
          let current = languageTranslations;
          
          // 遍历到倒数第二个key，确保路径存在
          for (let i = 0; i < keys.length - 1; i++) {
            const k = keys[i];
            if (!current[k] || typeof current[k] !== 'object') {
              current[k] = {};
            }
            current = current[k];
          }
          
          // 设置最后一个key的值
          const lastKey = keys[keys.length - 1];
          current[lastKey] = value || '';

          // 保存更新后的文件
          await fs.writeJson(filePath, languageTranslations, { spaces: 2 });
          
          results.push({
            code: languageCode,
            key,
            value,
            success: true
          });
        } catch (error) {
          errors.push({
            code: languageCode,
            key,
            error: error.message
          });
        }
      }
      
      // 只有在有成功更新的情况下才递增版本号
      if (results.length > 0) {
        await incrementVersion();
      }

      return {
        success: true,
        message: `Key '${key}' batch update completed`,
        data: {
          key,
          successCount: results.length,
          errorCount: errors.length,
          results,
          errors: errors.length > 0 ? errors : undefined
        }
      };
    } catch (error) {
      fastify.log.error('Error in batch key update:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to batch update language key',
        message: error.message
      });
    }
  });

  // 添加新的语言
  fastify.post('/language', async (request, reply) => {
    try {
      const { code, name, nativeName, enabled = true, overwrite = false } = request.body;
      
      if (!code || !name || !nativeName) {
        return reply.status(400).send({
          success: false,
          error: 'code, name, and nativeName are required'
        });
      }

      // 检查语言是否已存在
      const languageList = await fs.readJson(LANGUAGE_LIST_FILE);
      const existingLanguage = languageList.languages.find(lang => lang.code === code);
      
      if (existingLanguage && !overwrite) {
        return reply.status(409).send({
          success: false,
          error: `Language with code ${code} already exists. Set overwrite=true to replace it.`
        });
      }

      // 准备新语言对象
      const newLanguage = {
        code,
        name,
        nativeName,
        enabled,
        file: `${code}.json`
      };
      
      // 从模板创建语言文件
      const templatePath = path.join(__dirname, '../../data/language-template.json');
      const template = await fs.readJson(templatePath);
      const filePath = path.join(LANGUAGES_DIR, `${code}.json`);

      // 更新语言列表
      if (existingLanguage) {
        // 更新现有语言
        const index = languageList.languages.findIndex(lang => lang.code === code);
        languageList.languages[index] = newLanguage;
      } else {
        // 添加新语言
        languageList.languages.push(newLanguage);
      }
      
      // 同时写入语言列表和语言文件
      await Promise.all([
        fs.writeJson(LANGUAGE_LIST_FILE, languageList, { spaces: 2 }),
        fs.writeJson(filePath, template, { spaces: 2 })
      ]);
      
      // 自动递增版本号
      await incrementVersion();
      
      fastify.log.info(`Language files created successfully for ${code}`);

      const action = existingLanguage ? 'updated' : 'added';
      return {
        success: true,
        message: `Language ${code} ${action} successfully`,
        data: newLanguage
      };
    } catch (error) {
      fastify.log.error('Error adding new language:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to add new language',
        message: error.message
      });
    }
  });

  // 删除语言
  fastify.post('/language/:code/delete', async (request, reply) => {
    try {
      const { code } = request.params;
      
      // 读取语言列表
      const languageList = await fs.readJson(LANGUAGE_LIST_FILE);
      const languageIndex = languageList.languages.findIndex(lang => lang.code === code);
      
      if (languageIndex === -1) {
        return reply.status(404).send({
          success: false,
          error: `Language with code ${code} not found`
        });
      }

      // 不允许删除核心语言：中文、英文、繁体中文
      const protectedLanguages = ['zh-CN', 'en-US', 'zh-TW'];
      if (protectedLanguages.includes(code)) {
        return reply.status(400).send({
          success: false,
          error: `Cannot delete protected language: ${code}`
        });
      }

      // 从列表中移除
      languageList.languages.splice(languageIndex, 1);
      await fs.writeJson(LANGUAGE_LIST_FILE, languageList, { spaces: 2 });
      
      // 自动递增版本号
      await incrementVersion();

      // 删除语言文件
      const filePath = path.join(LANGUAGES_DIR, `${code}.json`);
      if (await fs.pathExists(filePath)) {
        await fs.remove(filePath);
      }

      return {
        success: true,
        message: `Language ${code} deleted successfully`
      };
    } catch (error) {
      fastify.log.error(`Error deleting language ${request.params.code}:`, error);
      reply.status(500).send({
        success: false,
        error: 'Failed to delete language',
        message: error.message
      });
    }
  });

  // 获取文件清单（用于增量更新）
  fastify.get('/manifest', async (request, reply) => {
    try {
      const languageList = await fs.readJson(LANGUAGE_LIST_FILE);
      
      const manifest = {
        version: languageList.version,
        lastUpdated: languageList.lastUpdated,
        files: {
          'language-list.json': {
            version: languageList.version,
            lastModified: (await fs.stat(LANGUAGE_LIST_FILE)).mtime.toISOString()
          }
        }
      };
      
      // 添加语言文件信息
      const languageFiles = await fs.readdir(LANGUAGES_DIR);
      for (const file of languageFiles) {
        if (file.endsWith('.json')) {
          const filePath = path.join(LANGUAGES_DIR, file);
          const stats = await fs.stat(filePath);
          manifest.files[`languages/${file}`] = {
            version: languageList.version,
            lastModified: stats.mtime.toISOString()
          };
        }
      }
      
      reply.header('Cache-Control', 'public, max-age=30');
      return {
        success: true,
        data: manifest
      };
    } catch (error) {
      fastify.log.error('Error creating manifest:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to create manifest',
        message: error.message
      });
    }
  });

  // 手动创建当前版本的语言包
  fastify.post('/download/create-package', async (request, reply) => {
    try {
      // 读取当前版本信息
      const languageList = await fs.readJson(LANGUAGE_LIST_FILE);
      const currentVersion = languageList.version;
      
      // 创建语言包
      const fileName = await createLanguagePackage(currentVersion);
      const filePath = path.join(DOWNLOADS_DIR, fileName);
      const stats = await fs.stat(filePath);
      
      // 返回创建结果
      reply.send({
        success: true,
        message: 'Language package created successfully',
        data: {
          fileName,
          version: currentVersion,
          fileSize: stats.size,
          downloadUrl: `/api/i18n/download/file/${fileName}`
        }
      });
      
    } catch (error) {
      fastify.log.error('Error creating language package:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to create language package',
        message: error.message
      });
    }
  });

  // 获取最新语言包下载URL
  fastify.get('/download/latest', async (request, reply) => {
    try {
      // 读取当前版本信息
      const languageList = await fs.readJson(LANGUAGE_LIST_FILE);
      const currentVersion = languageList.version;
      const fileName = `language-${currentVersion}.zip`;
      const filePath = path.join(DOWNLOADS_DIR, fileName);
      
      // 检查文件是否存在，如果不存在则创建
      if (!await fs.pathExists(filePath)) {
        await createLanguagePackage(currentVersion);
      }
      
      // 获取文件大小
      const stats = await fs.stat(filePath);
      
      // 返回下载URL
      const downloadUrl = `/api/i18n/download/file/${fileName}`;
      
      reply.send({
        success: true,
        data: {
          downloadUrl,
          fileName: `language-pack-${currentVersion}.zip`,
          fileSize: stats.size,
          version: currentVersion,
          lastUpdated: languageList.lastUpdated
        }
      });
      
    } catch (error) {
      fastify.log.error('Error getting latest download:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to get latest download',
        message: error.message
      });
    }
  });

  // 生成下载包并返回下载URL（保留原有接口兼容性）
  fastify.get('/download/all', async (request, reply) => {
    try {
      const archiver = require('archiver');
      const crypto = require('crypto');
      
      // 创建临时文件夹
      const tempDir = path.join(__dirname, '../../temp');
      await fs.ensureDir(tempDir);
      
      // 生成唯一文件名
      const timestamp = Date.now();
      const randomId = crypto.randomBytes(8).toString('hex');
      const fileName = `i18n-files-${timestamp}-${randomId}.zip`;
      const filePath = path.join(tempDir, fileName);
      
      // 创建ZIP文件
      const output = fs.createWriteStream(filePath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      
      archive.pipe(output);
      
      // 添加版本信息（从language-list.json中提取）
      const languageList = await fs.readJson(LANGUAGE_LIST_FILE);
      const versionInfo = {
        version: languageList.version,
        lastUpdated: languageList.lastUpdated
      };
      archive.append(JSON.stringify(versionInfo, null, 2), { name: 'version.json' });
      
      // 添加语言列表
      archive.append(JSON.stringify(languageList, null, 2), { name: 'language-list.json' });
      
      // 添加所有语言文件
      const languageFiles = await fs.readdir(LANGUAGES_DIR);
      for (const file of languageFiles) {
        if (file.endsWith('.json')) {
          const fileContentPath = path.join(LANGUAGES_DIR, file);
          const content = await fs.readJson(fileContentPath);
          archive.append(JSON.stringify(content, null, 2), { name: `languages/${file}` });
        }
      }
      
      // 等待ZIP文件创建完成
      await new Promise((resolve, reject) => {
        output.on('close', resolve);
        archive.on('error', reject);
        archive.finalize();
      });
      
      // 获取实际文件大小
      const stats = await fs.stat(filePath);
      
      // 返回下载URL
      const downloadUrl = `/api/i18n/download/file/${fileName}`;
      
      reply.send({
        success: true,
        data: {
          downloadUrl,
          fileName: 'i18n-files.zip',
          fileSize: stats.size
        }
      });
      
      // 设置定时清理（30分钟后删除文件）
      setTimeout(async () => {
        try {
          await fs.remove(filePath);
          console.log(`Cleaned up temporary file: ${fileName}`);
        } catch (err) {
          console.error('Failed to clean up temporary file:', err);
        }
      }, 30 * 60 * 1000);
      
    } catch (error) {
      fastify.log.error('Error creating download archive:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to create download archive',
        message: error.message
      });
    }
  });
  
  // 下载文件接口
  fastify.get('/download/file/:fileName', async (request, reply) => {
    try {
      const { fileName } = request.params;
      let filePath;
      
      // 首先检查下载目录（版本化的包）
      const downloadsPath = path.join(DOWNLOADS_DIR, fileName);
      if (await fs.pathExists(downloadsPath)) {
        filePath = downloadsPath;
      } else {
        // 如果不在下载目录，检查临时目录（兼容旧接口）
        const tempDir = path.join(__dirname, '../../temp');
        const tempPath = path.join(tempDir, fileName);
        if (await fs.pathExists(tempPath)) {
          filePath = tempPath;
        } else {
          return reply.status(404).send({
            success: false,
            error: 'File not found or expired'
          });
        }
      }
      
      // 获取文件大小
      const stats = await fs.stat(filePath);
      
      // 设置下载头
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Length', stats.size);
      reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
      reply.header('Cache-Control', 'no-cache');
      
      // 使用流式传输发送文件
      const stream = fs.createReadStream(filePath);
      return reply.send(stream);
      
    } catch (error) {
      fastify.log.error('Error downloading file:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to download file',
        message: error.message
      });
    }
  });
}

// 自动递增版本号
async function incrementVersion() {
  try {
    const languageList = await fs.readJson(LANGUAGE_LIST_FILE);
    const currentVersion = languageList.version || '1.0.0';
    const versionParts = currentVersion.split('.').map(Number);
    
    // 递增补丁版本号
    versionParts[2] = (versionParts[2] || 0) + 1;
    
    const newVersion = versionParts.join('.');
    const now = new Date().toISOString();
    
    // 更新版本号和最后更新时间
    languageList.version = newVersion;
    languageList.lastUpdated = now;
    
    await fs.writeJson(LANGUAGE_LIST_FILE, languageList, { spaces: 2 });
    
    // 自动创建新版本的语言包
    await createLanguagePackage(newVersion);
    
    return { version: newVersion, lastUpdated: now };
  } catch (error) {
    console.error('Error incrementing version:', error);
    throw error;
  }
}

// 版本比较工具函数
function compareVersions(version1, version2) {
  const v1parts = version1.split('.').map(Number);
  const v2parts = version2.split('.').map(Number);
  
  for (let i = 0; i < Math.max(v1parts.length, v2parts.length); i++) {
    const v1part = v1parts[i] || 0;
    const v2part = v2parts[i] || 0;
    
    if (v1part > v2part) return 1;
    if (v1part < v2part) return -1;
  }
  
  return 0;
}

// 创建语言包函数
async function createLanguagePackage(version) {
  try {
    const fileName = `language-${version}.zip`;
    const zipPath = path.join(DOWNLOADS_DIR, fileName);
    
    // 删除旧的同名文件（如果存在）
    if (await fs.pathExists(zipPath)) {
      await fs.remove(zipPath);
    }
    
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    return new Promise((resolve, reject) => {
      output.on('close', () => {
        console.log(`Language package created: ${fileName} (${archive.pointer()} bytes)`);
        resolve(fileName);
      });
      
      archive.on('error', (err) => {
        console.error('Archive error:', err);
        reject(err);
      });
      
      archive.pipe(output);
      
      // 添加语言配置文件
      archive.file(LANGUAGE_LIST_FILE, { name: 'language-list.json' });
      
      // 添加所有语言文件
      archive.directory(LANGUAGES_DIR, 'languages');
      
      archive.finalize();
    });
  } catch (error) {
    console.error('Error creating language package:', error);
    throw error;
  }
}

module.exports = i18nRoutes;
