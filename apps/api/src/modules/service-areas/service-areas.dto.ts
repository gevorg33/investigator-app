import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { MAX_BOUNDARY_VERTICES, MAX_RADIUS_KM, MIN_RADIUS_KM } from './service-areas.policy';

export class LonLatDto {
  // Longitude first everywhere, as in PostGIS. Reversing it puts Yerevan in the ocean.
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  lon!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  lat!: number;
}

export class CreateServiceAreaDto {
  @IsIn(['RADIUS', 'POLYGON'])
  kind!: 'RADIUS' | 'POLYGON';

  @IsString()
  @Length(1, 80)
  label!: string;

  // IsDefined is what refuses a missing centre: ValidateNested alone passes `undefined`, which
  // let a RADIUS area with no centre through to the service and a 500.
  @ValidateIf((o: CreateServiceAreaDto) => o.kind === 'RADIUS')
  @IsDefined()
  @ValidateNested()
  @Type(() => LonLatDto)
  centre?: LonLatDto;

  @ValidateIf((o: CreateServiceAreaDto) => o.kind === 'RADIUS')
  @IsInt()
  @Min(MIN_RADIUS_KM)
  @Max(MAX_RADIUS_KM)
  radiusKm?: number;

  @ValidateIf((o: CreateServiceAreaDto) => o.kind === 'POLYGON')
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(MAX_BOUNDARY_VERTICES)
  @ValidateNested({ each: true })
  @Type(() => LonLatDto)
  boundary?: LonLatDto[];
}
