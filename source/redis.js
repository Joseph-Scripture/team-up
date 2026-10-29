import Redis from "ioredis";
const redis= new Redis(process.env.REDIS_URL || "redis://localhost:6379",{
maxRetriesPerRequest:3,});
redis.on("error", (err)=>{
    console.error("Redis connection error:", err);
});
redis.on("connect", ()=>{
    console.log("Redis cache connection succesful")
});

export default redis;
