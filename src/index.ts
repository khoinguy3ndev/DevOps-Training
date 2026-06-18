import express, { Request, Response } from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
const PORT = process.env.PORT ?? 3000;

console.log('Hello World')

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', env: process.env.NODE_ENV });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));