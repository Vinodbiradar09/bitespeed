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
      if (email) {
        orConditions.push({ email });
      }
      if (phoneNumber) {
        orConditions.push({ phoneNumber });
      }
      let contacts = await this.db.contact.findMany({
        where: {
          OR: orConditions,
        },
        orderBy: { createdAt: 'asc' },
      });

      if (contacts.length === 0) {
        const primary = await this.db.contact.create({
          data: {
            email: createContactDto.email,
            phoneNumber: createContactDto.phoneNumber,
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
      const secondaries = contacts.filter(
        (c) => c.linkPrecedence === 'secondary',
      );
      let primaryContact: Contact;
      if (primaries.length > 0) {
        primaryContact = primaries[0];
      } else {
        const oldestSecondary = secondaries[0];
        if (!oldestSecondary.linkedId) {
          throw new Error('Secondary without linkedId');
        }
        const parent = await this.db.contact.findUnique({
          where: {
            id: oldestSecondary.linkedId,
          },
        });
        if (!parent) {
          throw new Error('primary contact not found');
        }
        primaryContact = parent;
      }
      const emailExists = email && contacts.some((c) => c.email === email);
      const phoneExists =
        phoneNumber && contacts.some((c) => c.phoneNumber === phoneNumber);

      if ((email && !emailExists) || (phoneNumber && !phoneExists)) {
        const secondary = await this.db.contact.create({
          data: {
            email: createContactDto.email,
            phoneNumber: createContactDto.phoneNumber,
            linkedId: primaryContact.id,
            linkPrecedence: 'secondary',
          },
        });
        contacts.push(secondary);
      }

      // merge multiple primaries
      const updatedPrimaries = contacts.filter(
        (c) => c.linkPrecedence === 'primary',
      );
      if (updatedPrimaries.length > 1) {
        const truePrimary = updatedPrimaries[0];
        const primariesToDemote = updatedPrimaries.slice(1);
        await this.db.$transaction([
          ...primariesToDemote.map((p) =>
            this.db.contact.update({
              where: {
                id: p.id,
              },
              data: {
                linkPrecedence: 'secondary',
                linkedId: truePrimary.linkedId,
              },
            }),
          ),
          this.db.contact.updateMany({
            where: {
              linkedId: {
                in: primariesToDemote.map((p) => p.id),
              },
            },
            data: {
              linkedId: truePrimary.id,
            },
          }),
        ]);
        primaryContact = truePrimary;
        contacts = await this.db.contact.findMany({
          where: {
            OR: [{ id: primaryContact.id }, { linkedId: truePrimary.id }],
          },
        });
      }

      const emailsSet = new Set<string>();
      const phonesSet = new Set<string>();
      const secondaryIds: number[] = [];
      if (primaryContact.email) emailsSet.add(primaryContact.email);
      if (primaryContact.phoneNumber) phonesSet.add(primaryContact.phoneNumber);
      for (const contact of contacts) {
        if (contact.id !== primaryContact.id) {
          secondaryIds.push(contact.id);
          if (contact.email) emailsSet.add(contact.email);
          if (contact.phoneNumber) phonesSet.add(contact.phoneNumber);
        }
      }
      return {
        contact: {
          primaryContatctId: primaryContact.id,
          emails: Array.from(emailsSet),
          phoneNumber: Array.from(phonesSet),
          secondaryContactIds: secondaryIds,
        },
      };
    } catch (error) {
      console.log(error);
    }
  }
}
