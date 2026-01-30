const assert = require('assert');
const Server = require('../packages/mlock-server').default;
const Client = require('../packages/mlock-client').default;
const { MlockError } = require('../packages/mlock-client');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 全局测试配置
const debug = false;

// 测试统计
let passed = 0;
let failed = 0;

function test(name, fn) {
  console.log(`\n🧪 ${name}`);
  return fn()
    .then(() => {
      console.log(`✅ PASS`);
      passed++;
    })
    .catch((error) => {
      console.log(`❌ FAIL: ${error.message}`);
      failed++;
      throw error;
    });
}

function assertThrows(fn, expectedError, expectedType) {
  return fn()
    .then(() => {
      throw new Error('Expected error to be thrown');
    })
    .catch((error) => {
      if (expectedError && !error.message.includes(expectedError)) {
        throw new Error(`Expected error message to include "${expectedError}", got "${error.message}"`);
      }
      if (expectedType && error.type !== expectedType) {
        throw new Error(`Expected error type "${expectedType}", got "${error.type}"`);
      }
    });
}

// 测试套件
(async () => {
  console.log('='.repeat(60));
  console.log('mlock 全方位测试套件');
  console.log('='.repeat(60));

  // ==================== 基础功能测试 ====================

  await test('1.1 单资源锁：上锁和释放', async () => {
    const port = 12401;
    const server = new Server({ debug, port });
    await server.listen();

    const client = new Client({ host: 'localhost', port, debug });
    const lockId = await client.lock('resource-1', 5000);
    assert(lockId && typeof lockId === 'string', 'lockId should be a string');
    await client.unlock(lockId);

    client.destroy();
    await server.close();
  });

  await test('1.2 多资源锁：原子性锁定', async () => {
    const port = 12402;
    const server = new Server({ debug, port });
    await server.listen();

    const client = new Client({ host: 'localhost', port, debug });
    const lockId = await client.lock('res-a|res-b|res-c', 5000);
    assert(lockId && typeof lockId === 'string', 'lockId should be a string');
    await client.unlock(lockId);

    client.destroy();
    await server.close();
  });

  await test('1.3 续期锁：延长过期时间', async () => {
    const port = 12403;
    const server = new Server({ debug, port });
    await server.listen();

    const client = new Client({ host: 'localhost', port, debug });
    const lockId = await client.lock('resource-1', 3000);

    await delay(1000);
    const newExpiredAt = await client.extend(lockId, 2000);
    assert(typeof newExpiredAt === 'number', 'expiredAt should be a number');

    await client.unlock(lockId);
    client.destroy();
    await server.close();
  });

  await test('1.4 Ping：检测连接', async () => {
    const port = 12404;
    const server = new Server({ debug, port });
    await server.listen();

    const client = new Client({ host: 'localhost', port, debug });
    const pong = await client.ping();
    assert(pong === 'pong', 'ping should return "pong"');

    client.destroy();
    await server.close();
  });

  await test('1.5 状态查询：获取服务器状态', async () => {
    const port = 12405;
    const server = new Server({ debug, port });
    await server.listen();

    const client = new Client({ host: 'localhost', port, debug });
    const status = await client.status();

    assert(typeof status === 'object', 'status should be an object');
    assert(typeof status.socketCount === 'number', 'socketCount should be a number');
    assert(typeof status.currentLocks === 'number', 'currentLocks should be a number');
    assert(typeof status.liveTime === 'number', 'liveTime should be a number');

    client.destroy();
    await server.close();
  });

  // ==================== 并发测试 ====================

  await test('2.1 并发锁：互斥性测试', async () => {
    const port = 12411;
    const server = new Server({ debug, port });
    await server.listen();

    const client1 = new Client({ host: 'localhost', port, debug });
    const client2 = new Client({ host: 'localhost', port, debug });

    const lockId1 = await client1.lock('shared-resource', 3000);

    // client2 应该等待
    const lockPromise = client2.lock('shared-resource', 3000);
    let locked = false;
    lockPromise.then(() => {
      locked = true;
    });

    await delay(500);
    assert(!locked, 'client2 should be waiting');

    await client1.unlock(lockId1);
    await lockPromise;

    await client2.unlock(await lockPromise);
    client1.destroy();
    client2.destroy();
    await server.close();
  });

  await test('2.2 多资源锁排队：等待所有资源', async () => {
    const port = 12412;
    const server = new Server({ debug, port });
    await server.listen();

    const client1 = new Client({ host: 'localhost', port, debug });
    const client2 = new Client({ host: 'localhost', port, debug });
    const client3 = new Client({ host: 'localhost', port, debug });

    // client1 锁定资源 A
    const lockId1 = await client1.lock('resource-a', 3000);

    // client3 锁定资源 B
    const lockId3 = await client3.lock('resource-b', 3000);

    // client2 请求 A+B，应该等待（两个资源都被占用）
    const lockPromise = client2.lock('resource-a|resource-b', 3000);
    let locked = false;
    lockPromise.then(() => {
      locked = true;
    });

    await delay(500);
    assert(!locked, 'client2 should be waiting for both resources');

    // 释放 A，client2 还要等 B
    await client1.unlock(lockId1);
    await delay(500);
    assert(!locked, 'client2 should still be waiting for resource-b');

    // 释放 B，client2 应该成功
    await client3.unlock(lockId3);
    await lockPromise;
    assert(locked, 'client2 should be locked now');

    await client2.unlock(await lockPromise);
    client1.destroy();
    client2.destroy();
    client3.destroy();
    await server.close();
  });

  await test('2.3 多资源锁：部分资源可用时不激活', async () => {
    const port = 12413;
    const server = new Server({ debug, port });
    await server.listen();

    const client1 = new Client({ host: 'localhost', port, debug });
    const client2 = new Client({ host: 'localhost', port, debug });

    // client1 锁定资源 A
    const lockId1 = await client1.lock('resource-a', 3000);

    // client2 请求 A+B+C，只有 B 和 C 可用
    const lockPromise = client2.lock('resource-a|resource-b|resource-c', 3000);
    let locked = false;
    lockPromise.then(() => {
      locked = true;
    });

    await delay(500);
    assert(!locked, 'client2 should not be activated (resource-a is locked)');

    // 释放 A
    await client1.unlock(lockId1);

    // client2 应该立即成功
    await lockPromise;
    assert(locked, 'client2 should be locked now');

    await client2.unlock(await lockPromise);
    client1.destroy();
    client2.destroy();
    await server.close();
  });

  await test('2.4 多资源锁：同一客户端多个多资源请求', async () => {
    const port = 12414;
    const server = new Server({ debug, port });
    await server.listen();

    const client1 = new Client({ host: 'localhost', port, debug });

    // 同一客户端可以锁定多组不同的资源
    const lockId1 = await client1.lock('group-a|group-b', 3000);
    const lockId2 = await client1.lock('group-c|group-d', 3000);

    // 释放第一组
    await client1.unlock(lockId1);

    // 第二组应该仍然持有
    await delay(100);
    await client1.unlock(lockId2);

    client1.destroy();
    await server.close();
  });

  await test('2.5 多资源锁：不同客户端交替请求', async () => {
    const port = 12415;
    const server = new Server({ debug, port });
    await server.listen();

    const client1 = new Client({ host: 'localhost', port, debug });
    const client2 = new Client({ host: 'localhost', port, debug });

    // client1 锁定 A+B
    const lockId1 = await client1.lock('res-a|res-b', 3000);

    // client2 锁定 C+D
    const lockId2 = await client2.lock('res-c|res-d', 3000);

    // 两个锁都应该成功（资源不冲突）
    assert(lockId1 && lockId2, 'Both clients should get locks');

    await client1.unlock(lockId1);
    await client2.unlock(lockId2);

    client1.destroy();
    client2.destroy();
    await server.close();
  });

  await test('2.6 多资源锁：资源冲突时队列顺序', async () => {
    const port = 12416;
    const server = new Server({ debug, port });
    await server.listen();

    const client1 = new Client({ host: 'localhost', port, debug });
    const client2 = new Client({ host: 'localhost', port, debug });
    const client3 = new Client({ host: 'localhost', port, debug });

    // client1 锁定 A+B
    const lockId1 = await client1.lock('res-a|res-b', 3000);

    // client2 请求 A+B+C
    const lock2Promise = client2.lock('res-a|res-b|res-c', 3000);
    let locked2 = false;
    lock2Promise.then(() => {
      locked2 = true;
    });

    await delay(100);

    // client3 也请求 A+B
    const lock3Promise = client3.lock('res-a|res-b', 3000);
    let locked3 = false;
    lock3Promise.then(() => {
      locked3 = true;
    });

    await delay(100);
    assert(!locked2 && !locked3, 'Both should be waiting');

    // 释放 A+B，client2 应该先获得锁（先到先得）
    await client1.unlock(lockId1);
    await lock2Promise;

    assert(locked2 && !locked3, 'client2 should be locked, client3 still waiting');

    // client2 释放锁
    await client2.unlock(await lock2Promise);

    // client3 应该获得锁
    await lock3Promise;
    assert(locked3, 'client3 should be locked now');

    await client3.unlock(await lock3Promise);
    client1.destroy();
    client2.destroy();
    client3.destroy();
    await server.close();
  });

  // ==================== 超时和过期测试 ====================

  await test('3.1 锁超时：获取锁超时', async () => {
    const port = 12421;
    const server = new Server({ debug, port });
    await server.listen();

    const client1 = new Client({ host: 'localhost', port, debug });
    const client2 = new Client({ host: 'localhost', port, debug });

    const lockId1 = await client1.lock('resource-1', 5000);

    await assertThrows(
      () => client2.lock('resource-1', 5000, 1000),
      'Lock timeout',
      'timeout'
    );

    await client1.unlock(lockId1);
    client1.destroy();
    client2.destroy();
    await server.close();
  });

  await test('3.2 锁过期：TTL 过期自动释放', async () => {
    const port = 12422;
    const server = new Server({ debug, port });
    await server.listen();

    const client1 = new Client({ host: 'localhost', port, debug });
    const client2 = new Client({ host: 'localhost', port, debug });

    // client1 锁定 1 秒
    await client1.lock('resource-1', 1000);

    // 等待锁过期
    await delay(1500);

    // client2 应该能立即获取锁
    const lockId2 = await client2.lock('resource-1', 5000);
    assert(lockId2, 'client2 should get the lock');

    await client2.unlock(lockId2);
    client1.destroy();
    client2.destroy();
    await server.close();
  });

  // ==================== 队列容忍度测试 ====================

  await test('4.1 队列溢出：tolerate 参数', async () => {
    const port = 12431;
    const server = new Server({ debug, port });
    await server.listen();

    const client1 = new Client({ host: 'localhost', port, debug });
    const client2 = new Client({ host: 'localhost', port, debug });
    const client3 = new Client({ host: 'localhost', port, debug });

    // client1 锁定资源
    const lockId1 = await client1.lock('resource-1', 10000);

    // client2 进入队列
    const lock2Promise = client2.lock('resource-1', 10000, 0, 1);
    await delay(100);

    // client3 应该立即失败（tolerate=1，队列已满）
    await assertThrows(
      () => client3.lock('resource-1', 10000, 0, 1),
      'can not tolerate',
      'tolerate'
    );

    await client1.unlock(lockId1);
    await lock2Promise;
    await client2.unlock(await lock2Promise);

    client1.destroy();
    client2.destroy();
    client3.destroy();
    await server.close();
  });

  // ==================== 错误处理测试 ====================

  await test('5.1 连接错误：服务器不可达', async () => {
    const client = new Client({ host: 'localhost', port: 19999, debug });

    await assertThrows(() => client.ping(), null, 'connection');

    client.destroy();
  });

  await test('5.2 参数错误：解锁不存在的锁', async () => {
    const port = 12441;
    const server = new Server({ debug, port });
    await server.listen();

    const client = new Client({ host: 'localhost', port, debug });

    await assertThrows(
      () => client.unlock('non-existent-lock-id'),
      'lock not exist',
      'request'
    );

    client.destroy();
    await server.close();
  });

  await test('5.3 参数错误：资源名称包含空格', async () => {
    const port = 12442;
    const server = new Server({ debug, port });
    await server.listen();

    const client = new Client({ host: 'localhost', port, debug });

    await assertThrows(
      () => client.lock('invalid resource', 5000),
      'can not includes',
      'request'
    );

    client.destroy();
    await server.close();
  });

  await test('5.4 续期不存在的锁', async () => {
    const port = 12443;
    const server = new Server({ debug, port });
    await server.listen();

    const client = new Client({ host: 'localhost', port, debug });

    await assertThrows(
      () => client.extend('non-existent-lock-id', 1000),
      'lock not exist',
      'request'
    );

    client.destroy();
    await server.close();
  });

  // ==================== 资源前缀测试 ====================

  await test('6.1 资源前缀：自动添加前缀', async () => {
    const port = 12451;
    const server = new Server({ debug, port });
    await server.listen();

    const client = new Client({ host: 'localhost', port, debug, prefix: 'order:' });

    const lockId = await client.lock('product:1001', 5000);
    await client.unlock(lockId);

    client.destroy();
    await server.close();
  });

  await test('6.2 URI 配置：通过 URI 连接', async () => {
    const port = 12452;
    const server = new Server({ debug, port });
    await server.listen();

    const client = new Client(`mlock://localhost:${port}?prefix=uri:&ttl=3000`);

    const lockId = await client.lock('test-resource');
    await client.unlock(lockId);

    client.destroy();
    await server.close();
  });

  // ==================== 连接池测试 ====================

  await test('7.1 连接池：多客户端共享连接', async () => {
    const port = 12461;
    const server = new Server({ debug, port });
    await server.listen();

    const client1 = new Client({ host: 'localhost', port, debug });
    const client2 = new Client({ host: 'localhost', port, debug });

    const lockId1 = await client1.lock('resource-1', 5000);
    const lockId2 = await client2.lock('resource-2', 5000);

    await client1.unlock(lockId1);
    await client2.unlock(lockId2);

    client1.destroy();
    client2.destroy();
    await server.close();
  });

  await test('7.2 销毁客户端：自动清理连接', async () => {
    const port = 12462;
    const server = new Server({ debug, port });
    await server.listen();

    const client1 = new Client({ host: 'localhost', port, debug });
    const client2 = new Client({ host: 'localhost', port, debug });

    const lockId1 = await client1.lock('resource-1', 5000);

    client1.destroy();
    await delay(500);

    // client2 应该仍然可以工作
    const lockId2 = await client2.lock('resource-1', 5000);
    await client2.unlock(lockId2);

    client2.destroy();
    await server.close();
  });

  // ==================== 断线重连测试 ====================

  await test('8.1 断线重连：服务器重启', async () => {
    const port = 12471;
    const server = new Server({ debug, port });
    await server.listen();

    const client = new Client({
      host: 'localhost',
      port,
      debug,
      socketId: 'test-client-1'
    });

    await client.ping();
    console.log('  Initial connection successful');

    // 关闭服务器
    await server.close();
    await delay(1500);
    console.log('  Server closed');

    // 重启服务器
    await server.listen();
    await delay(1000);
    console.log('  Server restarted');

    // 客户端应该自动重连
    await client.ping();
    console.log('  Auto-reconnected successfully');

    const lockId = await client.lock('resource-1', 5000);
    await client.unlock(lockId);

    client.destroy();
    await server.close();
  });

  // ==================== 性能测试 ====================

  await test('9.1 性能测试：大量并发锁', async () => {
    const port = 12481;
    const server = new Server({ debug, port });
    await server.listen();

    const client = new Client({ host: 'localhost', port, debug });

    // 创建 100 个不同的资源
    const lockIds = [];
    for (let i = 0; i < 100; i++) {
      const lockId = await client.lock(`resource-${i}`, 5000);
      lockIds.push(lockId);
    }

    assert(lockIds.length === 100, 'Should lock 100 resources');

    // 解锁所有
    for (const lockId of lockIds) {
      await client.unlock(lockId);
    }

    client.destroy();
    await server.close();
  });

  await test('9.2 性能测试：多资源锁', async () => {
    const port = 12482;
    const server = new Server({ debug, port });
    await server.listen();

    const client = new Client({ host: 'localhost', port, debug });

    // 锁定 10 个资源
    const resources = Array.from({ length: 10 }, (_, i) => `bulk-resource-${i}`).join('|');
    const lockId = await client.lock(resources, 5000);

    await client.unlock(lockId);

    client.destroy();
    await server.close();
  });

  // ==================== 边界条件测试 ====================

  await test('10.1 边界条件：空资源列表', async () => {
    const port = 12491;
    const server = new Server({ debug, port });
    await server.listen();

    const client = new Client({ host: 'localhost', port, debug });

    const lockId = await client.lock('', 5000);
    await client.unlock(lockId);

    client.destroy();
    await server.close();
  });

  await test('10.2 边界条件：极短 TTL', async () => {
    const port = 12492;
    const server = new Server({ debug, port });
    await server.listen();

    const client = new Client({ host: 'localhost', port, debug });

    const lockId = await client.lock('resource-1', 100);
    await delay(200);

    // 锁应该已过期，可以重新获取
    const lockId2 = await client.lock('resource-1', 5000);
    await client.unlock(lockId2);

    client.destroy();
    await server.close();
  });

  await test('10.3 边界条件：超时为 0（无限等待）', async () => {
    const port = 12493;
    const server = new Server({ debug, port });
    await server.listen();

    const client1 = new Client({ host: 'localhost', port, debug });
    const client2 = new Client({ host: 'localhost', port, debug });

    const lockId1 = await client1.lock('resource-1', 5000);

    // client2 无限等待
    let client2Locked = false;
    const lockPromise = client2.lock('resource-1', 5000, 0);
    lockPromise.then(() => {
      client2Locked = true;
    });

    await delay(100);
    assert(!client2Locked, 'client2 should be waiting');

    // 释放锁
    await client1.unlock(lockId1);

    // client2 应该成功
    await lockPromise;
    assert(client2Locked, 'client2 should be locked now');
    await client2.unlock(await lockPromise);

    client1.destroy();
    client2.destroy();
    await server.close();
  });

  // ==================== 测试总结 ====================

  console.log('\n' + '='.repeat(60));
  console.log('测试总结');
  console.log('='.repeat(60));
  console.log(`✅ 通过: ${passed}`);
  console.log(`❌ 失败: ${failed}`);
  console.log(`📊 总计: ${passed + failed}`);
  console.log('='.repeat(60));

  if (failed > 0) {
    process.exit(1);
  }
})().catch((error) => {
  console.error('\n💥 测试运行失败:', error);
  process.exit(1);
});
