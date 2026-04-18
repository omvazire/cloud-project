import mongoose from 'mongoose';
import dns from 'dns';

const connectDB = async () => {
  const uri = process.env.MONGODB_URI || '';
  const isPlaceholder = !uri || uri.includes('user:pass') || uri.includes('<user>');

  if (isPlaceholder) {
    console.log('No valid MONGODB_URI found — starting in-memory MongoDB...');
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const mongod = await MongoMemoryServer.create();
    const memUri = mongod.getUri();
    await mongoose.connect(memUri);
    console.log(`In-memory MongoDB running at ${memUri}`);
    return;
  }

  // Force Google Public DNS to resolve SRV records reliably
  // Many ISP/router DNS servers don't handle SRV lookups for mongodb+srv://
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

  const connectOptions = {
    family: 4,
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000,
    socketTimeoutMS: 45000,
    retryWrites: true,
    w: 'majority',
  };

  try {
    await mongoose.connect(uri, connectOptions);
    console.log('✅ MongoDB connected successfully to Atlas Cloud!');
  } catch (err) {
    console.error('❌ MongoDB Atlas connection failed:', err.message);

    // Attempt standard connection string as fallback
    if (uri.startsWith('mongodb+srv://')) {
      console.log('🔄 Attempting fallback with resolved hostnames...');
      try {
        // Extract credentials and database from the SRV URI
        const srvMatch = uri.match(/mongodb\+srv:\/\/([^:]+):([^@]+)@([^/]+)\/(.*)/);
        if (srvMatch) {
          const [, user, pass, host, dbAndParams] = srvMatch;
          // Resolve SRV records manually
          const srvRecords = await new Promise((resolve, reject) => {
            dns.resolveSrv(`_mongodb._tcp.${host}`, (err, records) => {
              if (err) reject(err);
              else resolve(records);
            });
          });
          const hosts = srvRecords.map(r => `${r.name}:${r.port}`).join(',');
          const fallbackUri = `mongodb://${user}:${pass}@${hosts}/${dbAndParams}&ssl=true&authSource=admin&replicaSet=atlas-${host.split('.')[0].replace('kela-gang-', '')}`;
          
          await mongoose.connect(fallbackUri, connectOptions);
          console.log('✅ MongoDB connected via fallback standard connection!');
          return;
        }
      } catch (fallbackErr) {
        console.error('❌ Fallback connection also failed:', fallbackErr.message);
      }
    }

    console.log('⚠️  Falling back to offline in-memory database...');
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const mongod = await MongoMemoryServer.create();
    const memUri = mongod.getUri();
    await mongoose.connect(memUri);
    console.log(`📦 In-memory MongoDB running at ${memUri}`);
  }
};

export default connectDB;
