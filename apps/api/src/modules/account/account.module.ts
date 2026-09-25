import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';

/** The signed-in account's own view and preferences (T-127). */
@Module({
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
