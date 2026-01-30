# mlock-server

Multi-resource distributed lock server

## 功能特性

- 原子性多资源锁支持
- TCP 协议通信
- 锁超时和续期
- 队列等待机制
- 断线重连支持
- 实时状态查询

## 安装

```bash
npm install mlock-server
```

## 快速开始

### JavaScript

```javascript
const Server = require('mlock-server');

const server = new Server({ port: 12340 });
await server.listen();
console.log('Server started on port 12340');
```

### TypeScript

```typescript
import Server from 'mlock-server';

const server = new Server({ port: 12340, debug: true });
await server.listen();
```

### CLI 命令

```bash
# 启动服务
npx mlock-server --port 12340

# 查看状态
npx mlock-status
```

## 配置选项

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| port | number | 12340 | 监听端口 |
| debug | boolean | false | 是否输出调试日志 |

## API

### constructor(options: ServerOptions)

创建服务端实例。

```javascript
const server = new Server({
  port: 12340,
  debug: true
});
```

### listen(): Promise<void>

启动服务监听。

```javascript
await server.listen();
```

### close(): Promise<void>

关闭服务，清理所有连接和锁。

```javascript
await server.close();
```

## 协议说明

mlock-server 使用简单的文本协议，通过 TCP 通信。

### 消息格式

所有消息以空格分隔，由 `packet-wrapper` 处理数据包边界。

### 命令列表

#### CONNECT

客户端连接认证。

```
connect <socketId> <apiVersion>
```

**响应：**
```
connected <version>
```

#### LOCK

请求上锁。

```
lock <requestId> <resources> <ttl> <timeout> <tolerate>
```

- `requestId`: 请求 ID，用于响应匹配
- `resources`: 资源列表，用 `|` 分隔
- `ttl`: 锁生存时间（毫秒）
- `timeout`: 上锁超时时间（毫秒），0 表示不超时
- `tolerate`: 容忍队列长度，0 表示不限制

**响应：**
```
result <requestId> success <lockId>
result <requestId> failed <error>
```

#### EXTEND

续期锁。

```
extend <requestId> <lockId> <ttl>
```

**响应：**
```
result <requestId> success <expiredAt>
result <requestId> failed <error>
```

#### UNLOCK

解锁。

```
unlock <requestId> <lockId>
```

**响应：**
```
result <requestId> success done
result <requestId> failed <error>
```

#### PING

心跳检测。

```
ping <requestId>
```

**响应：**
```
result <requestId> success pong
```

#### STATUS

查询服务器状态。

```
status <requestId>
```

**响应：**
```
result <requestId> success <statusJSON>
```

### 服务器推送消息

服务器会主动推送以下消息：

```
connected <version>        # 连接成功
error <message>            # 连接错误
locked <lockId>            # 锁获取成功
timeout <lockId>            # 锁超时
expired <lockId>           # 锁过期
```

## 状态查询

通过 Telnet 或 netcat 直接连接可获取状态：

```bash
nc localhost 12340
status
```

返回文本格式的状态信息：

```
socketCount: 1
currentLocks: 0
liveTime: 12345
lockCount: 5
lockedCount: 5
...
```

## 许可证

MIT
