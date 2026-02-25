import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateContactDto } from './dto/create-contact.dto';
import { PrismaServie } from 'src/prisma.service';
import { Contact, Prisma } from '@prisma/client';

@Injectable()
export class ContactsService {
  constructor(private readonly db: PrismaServie) {}

  async create(createContactDto: CreateContactDto) {
    try {
      const { email, phoneNumber } = createContactDto;

      if (!email && !phoneNumber) {
        throw new BadRequestException(
          'Either email or phoneNumber must be provided',
        );
      }

      // first check for the is email or phone exists if both not exists then it means we should create the primary
      const orConditions: Prisma.ContactWhereInput[] = [];
      if (email) orConditions.push({ email });
      if (phoneNumber) orConditions.push({ phoneNumber });

      const contacts = await this.db.contact.findMany({
        where: { OR: orConditions },
        orderBy: { createdAt: 'asc' },
      });

      if (contacts.length === 0) {
        const primary = await this.db.contact.create({
          data: {
            email,
            phoneNumber,
            linkPrecedence: 'primary',
          },
        });

        return {
          contact: {
            primaryContactId: primary.id,
            emails: primary.email ? [primary.email] : [],
            phoneNumbers: primary.phoneNumber ? [primary.phoneNumber] : [],
            secondaryContactIds: [],
          },
        };
      }

      // identify primary and create secondary
      const primaries = contacts.filter((c) => c.linkPrecedence === 'primary');
      let primaryContact: Contact;

      if (primaries.length > 0) {
        primaryContact = primaries[0];
      } else {
        const oldest = contacts[0];
        const linkedPrimary = await this.db.contact.findUnique({
          where: { id: oldest.linkedId! },
        });
        if (!linkedPrimary) {
          throw new BadRequestException('Linked primary contact not found');
        }
        primaryContact = linkedPrimary;
      }

      const emailExists = email && contacts.some((c) => c.email === email);
      const phoneExists =
        phoneNumber && contacts.some((c) => c.phoneNumber === phoneNumber);

      if ((email && !emailExists) || (phoneNumber && !phoneExists)) {
        await this.db.contact.create({
          data: {
            email,
            phoneNumber,
            linkedId: primaryContact.id,
            linkPrecedence: 'secondary',
          },
        });
      }

      const allPrimaries = await this.db.contact.findMany({
        where: {
          OR: [{ id: primaryContact.id }, { linkedId: primaryContact.id }],
        },
        orderBy: { createdAt: 'asc' },
      });

      const realPrimary = allPrimaries.find(
        (c) => c.linkPrecedence === 'primary',
      )!;

      const extraPrimaries = allPrimaries.filter(
        (c) => c.linkPrecedence === 'primary' && c.id !== realPrimary.id,
      );

      if (extraPrimaries.length > 0) {
        await this.db.$transaction([
          ...extraPrimaries.map((p) =>
            this.db.contact.update({
              where: { id: p.id },
              data: {
                linkPrecedence: 'secondary',
                linkedId: realPrimary.id,
              },
            }),
          ),
          this.db.contact.updateMany({
            where: {
              linkedId: { in: extraPrimaries.map((p) => p.id) },
            },
            data: { linkedId: realPrimary.id },
          }),
        ]);
      }

      const finalContacts = await this.db.contact.findMany({
        where: {
          OR: [{ id: realPrimary.id }, { linkedId: realPrimary.id }],
        },
        orderBy: { createdAt: 'asc' },
      });

      const emails = new Set<string>();
      const phones = new Set<string>();
      const secondaryIds: number[] = [];

      for (const c of finalContacts) {
        if (c.email) emails.add(c.email);
        if (c.phoneNumber) phones.add(c.phoneNumber);
        if (c.linkPrecedence === 'secondary') secondaryIds.push(c.id);
      }

      return {
        contact: {
          primaryContactId: realPrimary.id,
          emails: Array.from(emails),
          phoneNumbers: Array.from(phones),
          secondaryContactIds: secondaryIds,
        },
      };
    } catch (error) {
      console.log(error);
      throw error;
    }
  }
}
