import * as net from 'net';

/**
 * 服务端配置选项
 */
export interface ServerOptions {
  /**
   * 监听端口，默认 12340
   */
  port?: number;
  /**
   * 是否开启调试模式，开启后会输出详细日志
   */
  debug?: boolean;
}

/**
 * 分布式锁服务端
 *
 * 提供 TCP 协议接口，支持资源的分布式锁管理
 * 支持锁的超时、续期、队列等待等功能
 */
export default class Server {
  server: net.Server;
  options: ServerOptions;

  /**
   * 创建服务端实例
   * @param options 服务端配置选项
   */
  constructor(options: ServerOptions);

  /**
   * 启动服务监听
   */
  listen(): Promise<void>;

  /**
   * 关闭服务，清理所有连接和锁
   */
  close(): Promise<void>;
}
