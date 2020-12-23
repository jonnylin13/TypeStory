import * as net from 'net';
import * as winston from 'winston';
import { ServerType, WINSTON_FORMAT } from "../baseServer";
import { BaseServer } from "../baseServer";
import { PacketDelegator } from "../baseDelegator";
import { PacketReader } from "../../protocol/packet/packetReader";
import { ShopServerPacketDelegator } from "./shopServerDelegator";
import { Session } from "../session";


export class ShopServer extends BaseServer{

    static logger: winston.Logger = winston.createLogger({
        format: WINSTON_FORMAT,
        transports: [
            new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
            new winston.transports.File({ filename: 'logs/debug.log', level: 'debug' }),
            new winston.transports.Console({ level: 'debug' })
        ]
    });

    centerServerSocket: net.Socket;
    connected: boolean = false;
    packetDelegator: PacketDelegator;
    static instance: ShopServer;

    constructor() {
        super(ServerType.SHOP, 8485);
        // Establish connection with CenterServer
        this.packetDelegator = new ShopServerPacketDelegator();
        this.centerServerSocket = net.createConnection({ port: 8483 });
        ShopServer.instance = this;
    }

    isCenterServerSocket(session: Session) {
        return this.centerServerSocket.remoteAddress === session.remoteAddress;
    }

    isConnected(): boolean {
        return this.connected && (this.centerServerSocket !== undefined);
    }
    onConnection(session: Session): void {
        // TODO: Authenticate with one-time generated key
        this.connected = true;
        ShopServer.logger.info(`ShopServer has established CenterServer connection`);
    }

    onClose(session: Session, hadError: any): void {
        if (this.isCenterServerSocket(session)) {
            this.connected = false;
            delete this.centerServerSocket;
        }
        // TODO: Retry connection ???
    }

    onData(session: Session, data: Buffer): void {

        const packet = new PacketReader(data);
        const opcode = packet.readShort();

        if (this.isCenterServerSocket(session)) {
            this.packetDelegator.getHandler(opcode).handlePacket(packet, this.centerServerSocket);
        } else {
            // Potential malicious attack?
        }
    }

    onError(error: any): void {
        throw new Error("Method not implemented.");
    }

    onStart(): void {
        ShopServer.logger.info(`ShopServer has started listening on port ${this.port}`);
    }

    onShutdown(): void {
        throw new Error("Method not implemented.");
    }

}