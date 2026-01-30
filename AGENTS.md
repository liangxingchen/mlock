# mlock 代码库指南

## 项目概述
分布式锁服务，包含 server 和 client 两个包，使用 TypeScript 开发，Lerna 管理 monorepo。

## 构建命令
```bash
# 构建所有包并运行测试
npm run prepublish

# 单独构建
lerna run build
cd packages/mlock-server && npm run build
cd packages/mlock-client && npm run build

# 运行测试（自定义测试脚本）
npm run test
node test/index.js

# CLI 工具
npm run cli
```

## TypeScript 配置
- Target: ES2017
- Module: CommonJS
- Output: `lib/` 目录
- Comments: 构建时移除 (removeComments: true)
- 类型定义: `index.d.ts` (独立于编译输出)

## 代码格式化（Prettier）
```bash
# 单引号、分号、2 空格缩进、最大行宽 100、LF 换行符
```

## 项目结构
```
mlock/
├── packages/
│   ├── mlock-server/      # 分布式锁服务端
│   │   ├── src/index.ts   # 核心实现
│   │   ├── bin/           # CLI 命令
│   │   └── lib/           # 编译输出
│   └── mlock-client/      # 分布式锁客户端
│       ├── src/index.ts   # 核心实现
│       └── lib/           # 编译输出
├── test/                  # 自定义测试
└── scripts/               # 辅助脚本
```

## 代码风格规范

### 导入风格
```typescript
// 使用 ES6 import 语法
import net from 'net';
import PacketWrapper from 'packet-wrapper';
import { ServerOptions } from '..';
```

### 命名约定
```typescript
// 类名：PascalCase
export default class Server { }
export class MlockError extends Error { }

// 变量/函数/参数：camelCase
const socketId: string;
function objectToText(object: any) { }
interface Item { }

// 私有方法：下划线前缀
_connect() { }
onPacket = () => { }
```

### 对象创建
```typescript
// 使用 Object.create(null) 创建纯对象
this.sockets = Object.create(null);
this.locks = Object.create(null);
```

### 错误处理
```typescript
// 自定义错误类
export class MlockError extends Error {
  type?: string;
  constructor(message: string, type?: string) {
    super(message);
    this.type = type;
  }
}

// 通过返回结果报告错误
if (Number.isNaN(data.ttl)) {
  return this.sendResult(socket, request, false, 'ttl should be integer!');
}

// 抛出错误
if (prefix?.includes('|')) {
  throw new MlockError('prefix can not includes "|"', 'request');
}
```

### 异步操作
```typescript
// 使用 async/await
async lock(resource: string, ttl?: number): Promise<string> {
  await this.socket.connect();
  return lockId;
}

// 返回 Promise
listen(): Promise<void> {
  return new Promise((resolve, reject) => { });
}
```

### 定时器管理
```typescript
// 保存定时器引用以便清理
checkTimer: NodeJS.Timeout;
pingTimer?: NodeJS.Timer;

// 清理定时器
clearTimeout(this.checkTimer);
clearInterval(this.pingTimer);
```

### 语言规范
- 代码注释和文档：使用中文
- 包名/类名/变量名/方法名/参数名/属性名：使用英文
- 字符串消息：使用英文（协议消息）

### 类型注解
```typescript
// 接口定义
interface Lock {
  socket: string;
  lock: string;
  resources: string[];
  ttl: number;
}

// 类型注解
socket: net.Socket;
options: ServerOptions;

// 类型断言（谨慎使用）
// @ts-ignore - 仅在必要时使用
this.connect(...args);
```

### 模块声明扩展
```typescript
declare module 'net' {
  export interface Socket {
    id: string;
    checkConnectTimer?: any;
    connectedAt: number;
    lastLiveAt: number;
  }
}
```

### 调试日志
```typescript
// 使用 debug 选项控制日志输出
if (this.options.debug) {
  console.log('message');
  console.error(error);
}
```

### Socket 通信
```typescript
// 使用 packet-wrapper 处理数据包
import PacketWrapper from 'packet-wrapper';

// 编码发送
socket.write(PacketWrapper.encode(Buffer.from(message)));

// 解码接收
buffer.addChunk(chunk);
let packet = buffer.read();
```
