# mlock

Multi-resource distributed lock service

## 使用场景

### 电商下单防超卖

在电商系统中，订单创建接口通常需要加锁以防止库存超卖。传统的分布式锁方案存在以下问题：

**方案一：全局锁**
```
lock("order-create")  // 所有订单创建操作串行执行
```
问题：即使客户购买的商品完全不同，也无法并发处理，严重影响系统吞吐量。

**方案二：按商品分锁**
```
lock("product:1001")  // 商品 1001
lock("product:1002")  // 商品 1002
```
问题：一个订单包含多个商品时，无法保证原子性。可能在锁定商品 A 后，商品 B 被其他订单锁定，导致最终部分商品锁定失败或库存不一致。

**mlock 解决方案**
mlock 支持原子性地锁定多个资源，确保事务的完整性：
```
lock("product:1001|product:1002|product:1003")  // 原子性锁定多个商品
```
当所有涉及的商品资源可用时，才会成功锁定；如果任一商品已被锁定，则进入队列等待，直到所有资源同时可用。

## 多资源锁机制

### 原子性保证

多资源锁的核心是**原子性**：要么所有资源同时锁定成功，要么全部失败（进入等待队列）。

```
// 请求锁定 A、B、C 三个资源
lock("resource-a|resource-b|resource-c")
```

### 锁定流程

1. **请求阶段**：客户端请求锁定多个资源（用 `|` 分隔）
2. **检查阶段**：服务器检查每个资源的可用性
   - 如果所有资源都可用 → 立即锁定成功
   - 如果任一资源被锁定 → 进入队列等待
3. **排队阶段**：锁请求在所有相关资源的队列中排队
4. **激活阶段**：只有当所有资源同时可用时，锁才会被激活并返回 lockId

### 队列机制

每个资源维护一个独立的队列：

```
resource-a 队列: [Lock1(A|B), Lock3(A|C), ...]
resource-b 队列: [Lock1(A|B), Lock2(B|D), ...]
resource-c 队列: [Lock3(A|C), Lock4(C|E), ...]
```

**激活条件**：Lock1 请求 A+B，只有当 resource-a 和 resource-b 队列的首元素都是 Lock1 时才会激活。

### 示例场景

**场景一：所有资源可用**
```
时刻1: client1.lock("res-a|res-b|res-c")  // A、B、C 都可用
时刻1: lock 成功，返回 lockId
```

**场景二：部分资源被占用**
```
时刻1: client1.lock("res-a")               // client1 锁定 A
时刻2: client2.lock("res-a|res-b|res-c")  // client2 请求 A+B+C
时刻2: client2 进入队列等待（A 被占用）
时刻3: client1.unlock("res-a")          // client1 释放 A
时刻3: client2 激活成功
```

**场景三：多个请求排队**
```
时刻1: client1.lock("res-a")                    // 锁定 A
时刻2: client2.lock("res-a|res-b")             // 等待 A+B
时刻3: client3.lock("res-a|res-b")             // 等待 A+B（在队列中）
时刻4: client1.unlock("res-a")                 // 释放 A
时刻4: client2 激活成功（先到先得）
时刻5: client2.unlock("res-a|res-b")             // client2 释放
时刻6: client3 激活成功
```

### 核心特性

- **原子性**：多资源锁作为一个整体，要么全部成功，要么全部等待
- **队列优先级**：先到先得（FIFO）
- **资源独立**：不同资源组合可以并发锁定
- **状态追踪**：每个锁请求在所有相关资源队列中都有记录

## 安装

```bash
npm install mlock mlock-server
```

## 快速开始

### 1. 启动服务端

```javascript
const Server = require('mlock-server');

const server = new Server({ port: 12340 });
await server.listen();
```

或使用 CLI：

```bash
npx mlock-server
```

### 2. 使用客户端

```javascript
const Client = require('mlock');

const client = new Client({ host: 'localhost', port: 12340 });

// 锁定单个资源
const lockId1 = await client.lock('resource-1', 5000);
await client.unlock(lockId1);

// 锁定多个资源（原子性）
const lockId2 = await client.lock('product:1001|product:1002|product:1003', 5000);
await client.unlock(lockId2);

// 续期锁
await client.extend(lockId2, 3000);
```

## API 文档

### Server

```typescript
import Server from 'mlock-server';

const server = new Server(options: ServerOptions);

// 启动服务
await server.listen(): Promise<void>;

// 关闭服务
await server.close(): Promise<void>;
```

**ServerOptions**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| port | number | 12340 | 监听端口 |
| debug | boolean | false | 调试模式 |

### Client

```typescript
import Client from 'mlock';

const client = new Client(options: string | ClientOptions);

// 上锁
await client.lock(resource: string, ttl?: number, timeout?: number, tolerate?: number): Promise<string>;

// 续期
await client.extend(lock: string, ttl?: number): Promise<number>;

// 解锁
await client.unlock(lock: string): Promise<void>;

// Ping
await client.ping(): Promise<'pong'>;

// 获取状态
await client.status(): Promise<any>;

// 销毁客户端
client.destroy(): void;
```

**ClientOptions**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| uri | string | - | 连接 URI，格式如 `mlock://localhost:12340?timeout=5000&prefix=lock:&ttl=3000` |
| host | string | localhost | 服务器地址 |
| port | number | 12340 | 服务器端口 |
| prefix | string | - | 资源前缀 |
| ttl | number | - | 默认锁生存时间（毫秒） |
| timeout | number | - | 默认上锁超时时间（毫秒） |
| tolerate | number | - | 容忍队列长度 |
| socketId | string | - | Socket ID（用于重连） |
| debug | boolean | false | 调试模式 |

## 许可证

MIT
