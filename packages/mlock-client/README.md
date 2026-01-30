# mlock-client

Multi-resource distributed lock client for Node.js

## 功能特性

- 原子性多资源锁
- 自动重连
- 连接池复用
- Promise/Async-await API
- 锁超时和续期
- 队列等待和超时控制


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


## 安装

```bash
npm install mlock
```

## 快速开始

### JavaScript

```javascript
const Client = require('mlock');

const client = new Client({ host: 'localhost', port: 12340 });

// 锁定单个资源
const lockId = await client.lock('resource-1', 5000);

try {
  // 执行业务逻辑
  await doSomething();
} finally {
  await client.unlock(lockId);
}
```

### TypeScript

```typescript
import Client, { MlockError } from 'mlock';

const client = new Client({
  host: 'localhost',
  port: 12340,
  ttl: 5000,
  timeout: 10000
});

try {
  // 锁定多个资源（原子性）
  const lockId = await client.lock('product:1001|product:1002|product:1003');

  try {
    // 执行业务逻辑
    await processOrder();
  } finally {
    await client.unlock(lockId);
  }
} catch (error) {
  if (error instanceof MlockError) {
    console.error(`Lock error (${error.type}):`, error.message);
  }
}
```

## 配置选项

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| uri | string | - | 连接 URI，格式如 `mlock://localhost:12340?timeout=5000&prefix=lock:` |
| host | string | localhost | 服务器地址 |
| port | number | 12340 | 服务器端口 |
| prefix | string | - | 资源名称前缀，所有资源会自动加上此前缀 |
| ttl | number | - | 默认锁生存时间（毫秒） |
| timeout | number | - | 默认上锁超时时间（毫秒） |
| tolerate | number | - | 默认容忍队列长度 |
| socketId | string | - | Socket ID（用于断线重连后的身份识别） |
| debug | boolean | false | 调试模式 |

### URI 配置

支持通过 URI 配置所有选项：

```javascript
const client = new Client('mlock://localhost:12340?timeout=5000&ttl=3000&prefix=order:');

// 等价于
const client = new Client({
  host: 'localhost',
  port: 12340,
  timeout: 5000,
  ttl: 3000,
  prefix: 'order:'
});
```

## API

### constructor(options: string | ClientOptions)

创建客户端实例。

```javascript
// 使用对象配置
const client = new Client({
  host: 'localhost',
  port: 12340,
  ttl: 5000
});

// 使用 URI 配置
const client = new Client('mlock://localhost:12340');
```

### lock(resource: string, ttl?, timeout?, tolerate?): Promise<string>

上锁。如果资源已被锁定，会进入队列等待直到超时或获取到锁。

**参数：**
- `resource`: 资源描述字符串，多个资源用 `|` 分隔
- `ttl`: 锁生存时间（毫秒），未指定使用配置的默认值
- `timeout`: 上锁超时时间（毫秒），未指定使用配置的默认值
- `tolerate`: 容忍队列长度，未指定使用配置的默认值

**返回：** 锁 ID

**示例：**

```javascript
// 锁定单个资源
const lockId = await client.lock('product:1001', 5000, 10000, 10);

// 锁定多个资源（原子性，只有所有资源都可用时才会成功）
const lockId = await client.lock('product:1001|product:1002|product:1003');

try {
  // 执行业务逻辑
  await updateInventory(['1001', '1002', '1003']);
} finally {
  await client.unlock(lockId);
}
```

### extend(lockId: string, ttl?): Promise<number>

续期锁，延长锁的过期时间。

**参数：**
- `lockId`: 锁 ID
- `ttl`: 续期时间（毫秒），未指定使用配置的默认值

**返回：** 新的过期时间戳

**示例：**

```javascript
const lockId = await client.lock('resource', 5000);

// 长时间任务，定期续期
const renewInterval = setInterval(async () => {
  const newExpiredAt = await client.extend(lockId, 5000);
  console.log('Lock extended to:', new Date(newExpiredAt));
}, 4000);

try {
  await longRunningTask();
} finally {
  clearInterval(renewInterval);
  await client.unlock(lockId);
}
```

### unlock(lockId: string): Promise<void>

解锁，释放指定的锁。

**示例：**

```javascript
const lockId = await client.lock('resource', 5000);
try {
  await doSomething();
} finally {
  await client.unlock(lockId);
}
```

### ping(): Promise<'pong'>

Ping 服务器，检测连接是否正常。

```javascript
try {
  const pong = await client.ping();
  console.log('Connection is alive:', pong);
} catch (error) {
  console.error('Connection error:', error);
}
```

### status(): Promise<any>

获取服务器状态。

**返回：** 服务器状态对象

```javascript
const status = await client.status();
console.log('Socket count:', status.socketCount);
console.log('Current locks:', status.currentLocks);
console.log('Live time:', status.liveTime, 'ms');
```

### destroy(): void

销毁客户端，释放连接资源。

```javascript
client.destroy();
```

## 错误处理

mlock 使用自定义的 `MlockError` 类。

**错误类型：**

| 类型 | 说明 |
|------|------|
| connection | 连接错误（网络问题、服务器不可达等） |
| request | 请求错误（参数错误、资源名称无效等） |
| tolerate | 队列溢出（等待队列超过容忍值） |
| timeout | 超时错误（获取锁超时） |

**示例：**

```javascript
import Client, { MlockError } from 'mlock';

const client = new Client({ host: 'localhost', port: 12340 });

try {
  const lockId = await client.lock('resource', 5000);
  // ...
} catch (error) {
  if (error instanceof MlockError) {
    switch (error.type) {
      case 'timeout':
        console.error('获取锁超时');
        break;
      case 'tolerate':
        console.error('队列已满，无法等待');
        break;
      case 'connection':
        console.error('连接服务器失败');
        break;
      case 'request':
        console.error('请求参数错误:', error.message);
        break;
    }
  }
}
```

## 使用场景

### 电商订单

```javascript
const client = new Client({ prefix: 'order:' });

// 原子性锁定多个商品
const lockId = await client.lock('product:1001|product:1002|product:1003', 5000);

try {
  // 减少库存
  await deductInventory(['1001', '1002', '1003']);
  // 创建订单
  await createOrder([...]);
} finally {
  await client.unlock(lockId);
}
```

### 定时任务防重

```javascript
const client = new Client({ prefix: 'task:' });

const taskName = 'daily-report';
const lockId = await client.lock(taskName, 60000); // 1分钟

if (lockId) {
  try {
    await generateDailyReport();
  } finally {
    await client.unlock(lockId);
  }
} else {
  console.log('Task is already running');
}
```

## 连接池

同一 `host:port` 的客户端会自动复用连接：

```javascript
const client1 = new Client({ host: 'localhost', port: 12340 });
const client2 = new Client({ host: 'localhost', port: 12340 });
// client1 和 client2 共享同一个 TCP 连接
```

## 许可证

MIT
