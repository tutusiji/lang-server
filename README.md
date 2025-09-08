# Vue3 多语言 API 服务

基于 Fastify 构建的多语言管理 API 服务，为 Vue3 前端项目提供多语言配置和翻译文件的管理功能。

## 功能特性

- 🌍 多语言列表管理
- 📁 语言文件的增删改查
- 🔄 批量获取语言文件
- ⚙️ 动态配置管理
- 🛡️ CORS 跨域支持

## 快速开始

### 安装依赖
```bash
npm install
```

### 启动服务
```bash
# 开发模式 (热重载)
npm run dev

# 生产模式
npm start
```

服务默认运行在: `http://localhost:3001`

## API 接口文档

### 基础信息
- **Base URL**: `http://localhost:3001/api/i18n`
- **数据格式**: JSON
- **编码**: UTF-8

### 1. 获取支持的语言列表
```http
GET /api/i18n/languages
```

**响应示例:**
```json
{
  "success": true,
  "data": {
    "languages": [
      {
        "code": "zh-CN",
        "name": "简体中文",
        "nativeName": "中文",
        "enabled": true,
        "file": "zh-CN.json"
      },
      {
        "code": "en-US",
        "name": "English",
        "nativeName": "English",
        "enabled": true,
        "file": "en-US.json"
      }
    ],
    "defaultLanguage": "zh-CN",
    "fallbackLanguage": "zh-CN"
  }
}
```

### 2. 获取指定语言的翻译文件
```http
GET /api/i18n/language/:code
```

**参数:**
- `code`: 语言代码 (如: zh-CN, en-US)

**响应示例:**
```json
{
  "success": true,
  "data": {
    "code": "zh-CN",
    "translations": {
      "login": {
        "title": "登录系统",
        "username": "账号",
        "password": "密码"
      }
    }
  }
}
```

### 3. 批量获取多个语言文件
```http
POST /api/i18n/languages/batch
```

**请求体:**
```json
{
  "codes": ["zh-CN", "en-US", "ja-JP"]
}
```

**响应示例:**
```json
{
  "success": true,
  "data": {
    "zh-CN": { /* 中文翻译 */ },
    "en-US": { /* 英文翻译 */ }
  },
  "errors": [
    { "code": "ja-JP", "error": "File not found" }
  ]
}
```

### 4. 更新语言列表配置
```http
PUT /api/i18n/languages
```

**请求体:**
```json
{
  "languages": [
    {
      "code": "zh-CN",
      "name": "简体中文",
      "nativeName": "中文",
      "enabled": true,
      "file": "zh-CN.json"
    }
  ],
  "defaultLanguage": "zh-CN",
  "fallbackLanguage": "zh-CN"
}
```

### 5. 更新指定语言的翻译文件
```http
PUT /api/i18n/language/:code
```

**请求体:**
```json
{
  "translations": {
    "login": {
      "title": "登录系统",
      "username": "账号"
    }
  }
}
```

### 6. 添加新的语言
```http
POST /api/i18n/language
```

**请求体:**
```json
{
  "code": "fr-FR",
  "name": "法语",
  "nativeName": "Français",
  "enabled": true,
  "translations": {
    "login": {
      "title": "Connexion"
    }
  }
}
```

### 7. 删除语言
```http
DELETE /api/i18n/language/:code
```

**注意**: 不能删除默认语言和回退语言

## 项目结构

```
vue3-i18n-api/
├── src/
│   ├── server.js          # 主服务器文件
│   └── routes/
│       └── i18n.js        # i18n API 路由
├── data/
│   ├── language-list.json # 语言列表配置
│   └── languages/         # 语言文件目录
│       ├── zh-CN.json
│       ├── en-US.json
│       └── ...
├── package.json
└── README.md
```

## 前端集成示例

### Vue3 + Axios 使用示例

```javascript
// 获取语言列表
const getLanguages = async () => {
  const response = await axios.get('http://localhost:3001/api/i18n/languages');
  return response.data.data;
};

// 批量加载语言文件
const loadLanguageFiles = async (codes) => {
  const response = await axios.post('http://localhost:3001/api/i18n/languages/batch', {
    codes
  });
  return response.data.data;
};

// 更新语言文件
const updateLanguage = async (code, translations) => {
  const response = await axios.put(`http://localhost:3001/api/i18n/language/${code}`, {
    translations
  });
  return response.data;
};
```

### 动态加载语言文件

```javascript
// 在 Vue3 项目中动态加载语言
import { createI18n } from 'vue-i18n';

const setupI18n = async () => {
  // 1. 获取语言列表
  const languageConfig = await getLanguages();
  
  // 2. 批量加载启用的语言文件
  const enabledCodes = languageConfig.languages
    .filter(lang => lang.enabled)
    .map(lang => lang.code);
  
  const messages = await loadLanguageFiles(enabledCodes);
  
  // 3. 创建 i18n 实例
  return createI18n({
    legacy: false,
    locale: languageConfig.defaultLanguage,
    fallbackLocale: languageConfig.fallbackLanguage,
    messages
  });
};
```

## 环境变量

创建 `.env` 文件：
```env
PORT=3001
HOST=0.0.0.0
NODE_ENV=development
```

## 开发说明

- 语言文件存储在 `data/languages/` 目录下
- 语言列表配置存储在 `data/language-list.json`
- 支持热重载开发模式
- 已配置 CORS 支持跨域请求

## 错误处理

API 返回统一的错误格式：
```json
{
  "success": false,
  "error": "错误类型",
  "message": "详细错误信息"
}
```

常见错误代码：
- `400`: 请求参数错误
- `404`: 资源未找到
- `409`: 资源冲突（如语言已存在）
- `500`: 服务器内部错误
