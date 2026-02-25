import { Module } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { ContactsController } from './contacts.controller';
import { PrismaServie } from 'src/prisma.service';

@Module({
  controllers: [ContactsController],
  providers: [ContactsService, PrismaServie],
})
export class ContactsModule {}

