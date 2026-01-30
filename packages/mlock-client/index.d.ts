/**
 * 客户端配置选项
 */
export interface ClientOptions {
  /**
   * 连接 URI，格式如 `mlock://localhost:12340?timeout=5000&prefix=lock:`
   * URI 参数会覆盖 host、port、timeout、prefix 等选项
   */
  uri?: string;
  /**
   * 服务器主机地址，默认 localhost
   */
  host?: string;
  /**
   * 服务器端口，默认 12340
   */
  port?: number;
  /**
   * 资源名称前缀，所有资源名称会自动加上此前缀
   * 前缀中不能包含 `|` 或空格
   */
  prefix?: string;
  /**
   * 默认锁的生存时间（TTL），单位毫秒
   * 锁过期后会被自动释放
   */
  ttl?: number;
  /**
   * 默认上锁超时时间，单位毫秒
   * 如果在指定时间内无法获取锁，则返回超时错误
   */
  timeout?: number;
  /**
   * 默认容忍锁队列中等待的个数
   * 如果队列中等待的锁数量超过此值，直接报错，不等待到 timeout
   * 用于避免大量请求堆积
   */
  tolerate?: number;
  /**
   * 客户端 Socket ID，用于断线重连后的身份识别
   */
  socketId?: string;
  /**
   * 是否开启调试模式，开启后会输出详细日志
   */
  debug?: boolean;
}

/**
 * 分布式锁客户端
 *
 * 支持连接到 mlock-server 进行资源的分布式锁管理
 * 支持自动重连、连接池、多路复用等功能
 */
export default class Client {
  /**
   * 创建客户端实例
   * @param options 客户端配置选项，或连接 URI 字符串
   */
  constructor(options: string | ClientOptions);

  /**
   * 上锁
   * 如果资源已被锁定，会进入队列等待，直到超时或获取到锁
   * @param resource 资源描述字符串，同时锁定多个资源用 `|` 分隔
   * @param ttl 锁的生存时间，单位毫秒，未指定则使用配置的默认值
   * @param timeout 上锁超时时间，单位毫秒，未指定则使用配置的默认值
   * @param tolerate 容忍队列长度，未指定则使用配置的默认值
   * @returns Promise<string> 返回锁ID
   * @throws {MlockError} 超时、队列溢出、请求错误等情况下抛出异常
   */
  lock(resource: string, ttl?: number, timeout?: number, tolerate?: number): Promise<string>;

  /**
   * 续期锁
   * 延长锁的过期时间
   * @param lock 锁ID
   * @param ttl 续期时间，单位毫秒，未指定则使用配置的默认值
   * @returns Promise<number> 返回新的过期时间戳
   * @throws {MlockError} 锁不存在或未上锁时抛出异常
   */
  extend(lock: string, ttl?: number): Promise<number>;

  /**
   * 解锁
   * 释放指定的锁
   * @param lock 锁ID
   */
  unlock(lock: string): Promise<void>;

  /**
   * Ping 服务器
   * 用于检测连接是否正常
   * @returns Promise<'pong'> 连接正常返回 'pong'
   */
  ping(): Promise<'pong'>;

  /**
   * 获取服务器状态
   * 返回服务器的统计信息和当前锁状态
   * @returns Promise<any> 服务器状态对象，包含 socketCount、currentLocks 等信息
   */
  status(): Promise<any>;

  /**
   * 销毁客户端，释放连接资源
   */
  destroy(): void;
}

/**
 * mlock 自定义错误类
 */
export class MlockError extends Error {
  /**
   * 错误类型
   * - connection: 连接错误（网络问题、服务器不可达等）
   * - request: 请求错误（参数错误、资源名称无效等）
   * - tolerate: 队列溢出（等待队列超过容忍值）
   * - timeout: 超时错误（获取锁超时）
   */
  type?: 'connection' | 'request' | 'tolerate' | 'timeout';
}
