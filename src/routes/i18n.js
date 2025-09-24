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

  // 新增key接口 - 专门用于创建新的key，包含重复检查
  fastify.post('/languages/create-key', async (request, reply) => {
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

      // 检查key是否已存在
      const languageList = await fs.readJson(LANGUAGE_LIST_FILE);
      const checkKeyExists = (obj, keyPath) => {
        const parts = keyPath.split('.');
        let current = obj;
        for (const part of parts) {
          if (!current || typeof current !== 'object' || !(part in current)) {
            return false;
          }
          current = current[part];
        }
        return true;
      };
      
      // 检查所有语言文件中是否已存在该key
      for (const lang of languageList.languages) {
        const filePath = path.join(LANGUAGES_DIR, `${lang.code}.json`);
        if (await fs.pathExists(filePath)) {
          try {
            const data = await fs.readJson(filePath);
            if (checkKeyExists(data, key)) {
              return reply.status(409).send({
                success: false,
                error: `Key '${key}' already exists. Please use a different key name.`,
                code: 'KEY_ALREADY_EXISTS'
              });
            }
          } catch { /* ignore file read errors */ }
        }
      }

      // 创建新key
      const results = [];
      const errors = [];

      for (const [languageCode, value] of Object.entries(translations)) {
        try {
          const filePath = path.join(LANGUAGES_DIR, `${languageCode}.json`);
          
          let languageTranslations = {};
          if (await fs.pathExists(filePath)) {
            languageTranslations = await fs.readJson(filePath);
          }

          // 创建嵌套结构
          const keys = key.split('.');
          let current = languageTranslations;
          
          for (let i = 0; i < keys.length - 1; i++) {
            const k = keys[i];
            if (!current[k] || typeof current[k] !== 'object') {
              current[k] = {};
            }
            current = current[k];
          }
          
          const lastKey = keys[keys.length - 1];
          current[lastKey] = value || '';

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
      
      // 传播到所有其他语言
      if (results.length > 0) {
        const providedMap = Object.fromEntries(results.map(r => [r.code, r.value]))
        await propagateKeyToAllLanguages(key, null, '', providedMap)
      }

      // 注意：版本更新在 propagateKeyToAllLanguages 中已处理

      return reply.send({
        success: true,
        message: `Key '${key}' created successfully`,
        data: {
          key,
          successCount: results.length,
          errorCount: errors.length,
          results,
          errors: errors.length > 0 ? errors : undefined
        }
      });
    } catch (error) {
      fastify.log.error('Error creating key:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to create key',
        message: error.message
      });
    }
  });

  // 更新现有key接口 - 专门用于修改现有key的翻译内容，不检查重复
  fastify.put('/languages/update-key', async (request, reply) => {
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

      // 直接更新，不检查重复
      for (const [languageCode, value] of Object.entries(translations)) {
        try {
          const filePath = path.join(LANGUAGES_DIR, `${languageCode}.json`);
          
          let languageTranslations = {};
          if (await fs.pathExists(filePath)) {
            languageTranslations = await fs.readJson(filePath);
          }

          // 创建或更新嵌套结构
          const keys = key.split('.');
          let current = languageTranslations;
          
          for (let i = 0; i < keys.length - 1; i++) {
            const k = keys[i];
            if (!current[k] || typeof current[k] !== 'object') {
              current[k] = {};
            }
            current = current[k];
          }
          
          const lastKey = keys[keys.length - 1];
          current[lastKey] = value || '';

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

      // 触发版本更新
      await incrementVersion();

      return reply.send({
        success: true,
        message: `Key '${key}' updated successfully`,
        data: {
          key,
          successCount: results.length,
          errorCount: errors.length,
          results,
          errors: errors.length > 0 ? errors : undefined
        }
      });
    } catch (error) {
      fastify.log.error('Error updating key:', error);
      reply.status(500).send({
        success: false,
        error: 'Failed to update key',
        message: error.message
      });
    }
  });

  // 重命名 key（迁移所有语言）
  fastify.post('/languages/rename-key', async (request, reply) => {
    try {
      const { oldKey, newKey, overwrite = false } = request.body || {};
      if (!oldKey || !newKey || typeof oldKey !== 'string' || typeof newKey !== 'string') {
        return reply.status(400).send({ success: false, error: 'oldKey & newKey are required strings' });
      }
      if (oldKey === newKey) {
        return reply.status(400).send({ success: false, error: 'oldKey and newKey must be different' });
      }
      const KEY_PATTERN = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/;
      if (!KEY_PATTERN.test(oldKey) || !KEY_PATTERN.test(newKey)) {
        return reply.status(400).send({ success: false, error: 'Key format invalid (module.segment[.sub]...)' });
      }

      const languageList = await fs.readJson(LANGUAGE_LIST_FILE);

      // 工具函数
      const getNestedValue = (obj, keyPath) => {
        const parts = keyPath.split('.');
        let cur = obj;
        for (const p of parts) {
          if (!cur || typeof cur !== 'object' || !(p in cur)) return undefined;
          cur = cur[p];
        }
        return cur;
      };
      const deleteNestedKey = (obj, keyPath) => {
        const parts = keyPath.split('.');
        const stack = [];
        let cur = obj;
        for (let i = 0; i < parts.length - 1; i++) {
          const p = parts[i];
            if (!cur[p] || typeof cur[p] !== 'object') return false; // 不存在直接返回
          stack.push({ parent: cur, key: p });
          cur = cur[p];
        }
        const last = parts[parts.length - 1];
        if (cur && Object.prototype.hasOwnProperty.call(cur, last)) {
          delete cur[last];
          // 清理空对象链
          for (let i = stack.length - 1; i >= 0; i--) {
            const { parent, key } = stack[i];
            if (parent[key] && typeof parent[key] === 'object' && Object.keys(parent[key]).length === 0) {
              delete parent[key];
            } else break;
          }
          return true;
        }
        return false;
      };

      // 检查新 key 是否已存在（任意语言），除非 overwrite
      let conflict = false;
      for (const lang of languageList.languages) {
        const filePath = path.join(LANGUAGES_DIR, `${lang.code}.json`);
        if (await fs.pathExists(filePath)) {
          try {
            const data = await fs.readJson(filePath);
            if (getNestedValue(data, newKey) !== undefined) { conflict = true; break; }
          } catch { /* ignore */ }
        }
      }
      if (conflict && !overwrite) {
        return reply.status(409).send({ success: false, error: `newKey '${newKey}' already exists (set overwrite=true to force)` });
      }

      const changes = [];
      for (const lang of languageList.languages) {
        const code = lang.code;
        const filePath = path.join(LANGUAGES_DIR, `${code}.json`);
        let data = {};
        if (await fs.pathExists(filePath)) {
          try { data = await fs.readJson(filePath); } catch { data = {}; }
        }
        const val = getNestedValue(data, oldKey);
        if (val !== undefined) {
          // 写入新 key（覆盖策略）
          if (getNestedValue(data, newKey) === undefined || overwrite) {
            setNestedKey(data, newKey, val);
          }
          deleteNestedKey(data, oldKey);
          await fs.writeJson(filePath, data, { spaces: 2 });
          changes.push({ code, moved: true });
        } else {
          changes.push({ code, moved: false });
        }
      }

      // bump 版本
      await incrementVersion();

      return reply.send({
        success: true,
        message: 'Key renamed successfully',
        data: {
          oldKey,
          newKey,
          overwrite,
          languages: changes
        }
      });
    } catch (error) {
      fastify.log.error('Error renaming key:', error);
      reply.status(500).send({ success: false, error: 'Failed to rename key', message: error.message });
    }
  });

  // 删除 key（所有语言与模板）
  fastify.post('/languages/delete-key', async (request, reply) => {
    try {
      const { key, cleanEmpty = true } = request.body || {};
      if (!key || typeof key !== 'string') {
        return reply.status(400).send({ success: false, error: 'key is required string' });
      }
      const KEY_PATTERN = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/;
      if (!KEY_PATTERN.test(key)) {
        return reply.status(400).send({ success: false, error: 'Key format invalid' });
      }
      const languageList = await fs.readJson(LANGUAGE_LIST_FILE);
      
      const deleteNestedKey = (obj, keyPath) => {
        const segs = keyPath.split('.');
        const stack = [];
        let cur = obj;
        for (let i = 0; i < segs.length - 1; i++) {
          const s = segs[i];
          if (!cur[s] || typeof cur[s] !== 'object') return false; // 不存在
          stack.push({ parent: cur, key: s });
          cur = cur[s];
        }
        const last = segs[segs.length - 1];
        if (cur && Object.prototype.hasOwnProperty.call(cur, last)) {
          delete cur[last];
          if (cleanEmpty) {
            for (let i = stack.length - 1; i >= 0; i--) {
              const { parent, key } = stack[i];
              if (parent[key] && typeof parent[key] === 'object' && Object.keys(parent[key]).length === 0) {
                delete parent[key];
              } else break;
            }
          }
          return true;
        }
        return false;
      };

      const deletedLanguages = [];
      for (const lang of languageList.languages) {
        const code = lang.code;
        const filePath = path.join(LANGUAGES_DIR, `${code}.json`);
        if (!(await fs.pathExists(filePath))) continue;
        let data = {};
        try { data = await fs.readJson(filePath); } catch { data = {}; }
        const before = JSON.stringify(data);
        const removed = deleteNestedKey(data, key);
        if (removed) {
          await fs.writeJson(filePath, data, { spaces: 2 });
          deletedLanguages.push(code);
        }
      }

      if (deletedLanguages.length === 0) {
        return reply.send({ success: true, message: 'Key not found', data: { key, deletedLanguages: [] } });
      }

      await incrementVersion();
      return reply.send({ success: true, message: 'Key deleted successfully', data: { key, deletedLanguages } });
    } catch (error) {
      fastify.log.error('Error deleting key:', error);
      reply.status(500).send({ success: false, error: 'Failed to delete key', message: error.message });
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

      // 检查语言是否已存在 - 后端校验
      const languageList = await fs.readJson(LANGUAGE_LIST_FILE);
      const existingLanguage = languageList.languages.find(lang => lang.code === code);
      
      if (existingLanguage) {
        return reply.status(409).send({
          success: false,
          error: `Language with code '${code}' already exists.`
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
      
      // 使用 zh-CN.json 作为模板创建语言文件
      const zhCNPath = path.join(LANGUAGES_DIR, 'zh-CN.json');
      let template = {};
      if (await fs.pathExists(zhCNPath)) {
        template = await fs.readJson(zhCNPath);
        // 清空所有 key 的值，保留结构
        const clearValues = (obj) => {
          for (const key in obj) {
            if (typeof obj[key] === 'object' && obj[key] !== null) {
              clearValues(obj[key]);
            } else {
              obj[key] = '';
            }
          }
          return obj;
        };
        template = clearValues({ ...template });
      }
      
      const filePath = path.join(LANGUAGES_DIR, `${code}.json`);

      // 添加新语言到列表
      languageList.languages.push(newLanguage);
      
      // 同时写入语言列表和语言文件
      await Promise.all([
        fs.writeJson(LANGUAGE_LIST_FILE, languageList, { spaces: 2 }),
        fs.writeJson(filePath, template, { spaces: 2 })
      ]);
      
      // 自动递增版本号
      await incrementVersion();
      
      fastify.log.info(`Language files created successfully for ${code}`);

      return {
        success: true,
        message: `Language ${code} added successfully`,
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
    
    // 确保有三段版本号
    while (versionParts.length < 3) {
      versionParts.push(0);
    }
    
    // 三段式版本号自增逻辑，每段满100进位
    versionParts[2] = (versionParts[2] || 0) + 1;
    
    // 检查进位
    if (versionParts[2] >= 100) {
      versionParts[2] = 0;
      versionParts[1] = (versionParts[1] || 0) + 1;
      
      if (versionParts[1] >= 100) {
        versionParts[1] = 0;
        versionParts[0] = (versionParts[0] || 0) + 1;
      }
    }
    
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

// 工具：设置嵌套 key （如 a.b.c）
function setNestedKey(root, keyPath, value) {
  const parts = keyPath.split('.');
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

// 将 key 同步到所有语言文件（未提供翻译时填空字符串）
async function propagateKeyToAllLanguages(key, justUpdatedCode = null, updatedValue = '', providedMap = null) {
  try {
    const languageList = await fs.readJson(LANGUAGE_LIST_FILE);
    
    // 遍历语言文件
    for (const lang of languageList.languages) {
      const code = lang.code;
      const filePath = path.join(LANGUAGES_DIR, `${code}.json`);
      let data = {};
      if (await fs.pathExists(filePath)) {
        try { data = await fs.readJson(filePath); } catch { data = {}; }
      }
      // 判断是否已存在
      let exists = true;
      let probe = data;
      const parts = key.split('.');
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (i === parts.length - 1) {
          if (probe[p] === undefined) exists = false;
        } else {
          if (!probe[p] || typeof probe[p] !== 'object') { exists = false; break; }
          probe = probe[p];
        }
      }
      if (!exists) {
        const val = providedMap ? (providedMap[code] ?? '') : (code === justUpdatedCode ? updatedValue : '');
        setNestedKey(data, key, val);
        await fs.writeJson(filePath, data, { spaces: 2 });
      } else if (justUpdatedCode && code === justUpdatedCode) {
        // 保证更新值写入（单 key 更新时）
        setNestedKey(data, key, updatedValue);
        await fs.writeJson(filePath, data, { spaces: 2 });
      } else if (providedMap && Object.prototype.hasOwnProperty.call(providedMap, code)) {
        setNestedKey(data, key, providedMap[code]);
        await fs.writeJson(filePath, data, { spaces: 2 });
      }
    }

    // 统一 bump 版本
    await incrementVersion();
  } catch (err) {
    console.error('propagateKeyToAllLanguages failed:', err);
  }
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
