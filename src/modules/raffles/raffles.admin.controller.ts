import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateRaffleDto } from './dto/create-raffle.dto';
import { UpdateRaffleDto } from './dto/update-raffle.dto';
import { RafflesService } from './raffles.service';

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@Controller('admin/raffles')
export class RafflesAdminController {
  constructor(private readonly rafflesService: RafflesService) {}

  @Get()
  adminList() {
    return this.rafflesService.adminListAll();
  }

  @Get(':id')
  adminGet(@Param('id') id: string) {
    return this.rafflesService.adminGetById(id);
  }

  @Post()
  create(@Body() dto: CreateRaffleDto, @Req() req: any) {
    return this.rafflesService.adminCreate(dto, req.user.sub);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRaffleDto) {
    return this.rafflesService.adminUpdate(id, dto);
  }

  @Patch(':id/start')
  start(@Param('id') id: string) {
    return this.rafflesService.adminStart(id);
  }

  @Patch(':id/close')
  close(@Param('id') id: string) {
    return this.rafflesService.adminClose(id);
  }
}
