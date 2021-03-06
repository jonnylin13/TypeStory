import { ServerType } from "../baseServer";
import { PacketReader } from "../../protocol/packets/packetReader";
import { LoginServerPacketDelegator } from "./loginServerDelegator";
import { Session } from "../session";
import { AES } from '../../protocol/crypto/aes';
import { EncryptedSession } from '../../protocol/crypto/encryptedSession';
import { PreLoginClient } from './types/preLoginClient';
import { LoginPackets } from './loginPackets';
import { Shanda } from '../../protocol/crypto/shanda';
import { Config } from '../../util/config';
import { WorkerServer } from '../workerServer';
import { LoginClient } from "./types/loginClient";
import { CommonPackets } from "../commonPackets";


export class LoginServer extends WorkerServer {


    static instance: LoginServer;

    preLoginStore: Map<number, PreLoginClient> = new Map();
    loginStore: Map<number, LoginClient> = new Map();
    sessionStore: Map<number, EncryptedSession> = new Map();

    constructor() {
        super(ServerType.LOGIN, Config.instance.login.host, Config.instance.login.port);
        // Establish connection with CenterServer
        this.packetDelegator = new LoginServerPacketDelegator();
        LoginServer.instance = this;
    }

    onConnection(session: Session): void {
        if (this.isCenterServer(session)) {
            this.connected = true;
            this.logger.info(`LoginServer has established CenterServer connection`);
        } else {
            // MapleStory client connection
            this.logger.info(`LoginServer received a client connection: session ${session.id} @ ${session.socket.remoteAddress}`);

            let ivRecv = Buffer.from([70, 114, Math.round(Math.random() * 127), 82]);
            // let ivSend = Buffer.from([82, 48, Math.round(Math.random() * 127), 115]);
            let ivSend = Buffer.from([0x52, 0x30, 0x78, 0x61]);
            const sendCypher = new AES(ivSend, 0xffff - 83);
            const recvCypher = new AES(ivRecv, 83);
            const encSession = new EncryptedSession(session, sendCypher, recvCypher);
            this.sessionStore.set(session.id, encSession);
            console.log(ivSend.toString('hex').match(/../g).join(' '));
            session.socket.write(LoginPackets.getLoginHandshake(83, ivRecv, ivSend));
        }
    }

    onClose(session: Session, hadError: any): void {
        if (this.isCenterServer(session)) {
            this.connected = false;
            delete this.centerServerSession;
            this.logger.error(`LoginServer disconnected from CenterServer`);
            // TODO: Retry connection ???
        } else {
            // Clear local stores
            if (this.preLoginStore.has(session.id)) this.preLoginStore.delete(session.id);
            if (this.loginStore.has(session.id)) this.loginStore.delete(session.id);
            if (this.sessionStore.has(session.id)) this.sessionStore.delete(session.id);
            this.logger.info(`Session ${session.id} disconnected from LoginServer`);
        }
    }

    onData(session: Session, data: Buffer): void {
        if (this.isCenterServer(session)) {
            const packet = new PacketReader(data);
            const opcode = packet.readShort();

            const packetHandler = this.packetDelegator.getHandler(opcode);

            if (packetHandler === undefined) {
                this.logger.warn(`LoginServer unhandled packet 0x${opcode.toString(16)} from CenterServer`);
                return;
            }
            this.logger.debug(`LoginServer handling packet 0x${opcode.toString(16)} from CenterServer`);
            packetHandler.handlePacket(packet, session);
        } else {
            if (!this.sessionStore.has(session.id)) {
                // Never reached
                this.logger.warn(`LoginServer received a packet from ${session.socket.remoteAddress} before session could be registered`);
                return;
            }

            const encryptedSession = this.sessionStore.get(session.id);
            let dataNoHeader = data.slice(4); // Remove packet header
            // TODO: Validate header
            encryptedSession.recvCrypto.transform(dataNoHeader);
            const decryptedData = Shanda.decrypt(dataNoHeader);
            this.logger.debug(`Received from session ${session.id}: ${decryptedData.toString('hex').match(/../g).join(' ')}`);
            const packet = new PacketReader(decryptedData);
            const opcode = packet.readShort();

            if (opcode >= 0x200) {
                this.logger.warn(`Potential malicious attack to LoginServer from ${session.socket.remoteAddress} packet id 0x${opcode.toString(16)}`);
                session.socket.destroy();
                return;
            }
            
            const packetHandler = this.packetDelegator.getHandler(opcode);
            if (packetHandler === undefined && !session.isHandling(opcode)) {
                this.logger.warn(`LoginServer unhandled packet 0x${opcode.toString(16)} from client`);
                return;
            }

            if (packetHandler !== undefined) {
                this.logger.debug(`LoginServer handling packet 0x${opcode.toString(16)} from ${session.socket.remoteAddress}`);
                packetHandler.handlePacket(packet, session);
            }
        }
    }

    onError(error: any): void {
        this.logger.error(error.message);
    }

    onStart(): void {
        this.logger.info(`LoginServer has started listening on port ${this.port}`);
    }

    onShutdown(): void {
        throw new Error("Method not implemented.");
    }

}