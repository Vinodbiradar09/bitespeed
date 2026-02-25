import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateContactDto } from './dto/create-contact.dto';
import { PrismaServie } from 'src/prisma.service';
import { Contact, Prisma } from '@prisma/client';

@Injectable()
export class ContactsService {
  constructor(private readonly db: PrismaServie) {}
  async create(createContactDto: CreateContactDto) {
   
}


