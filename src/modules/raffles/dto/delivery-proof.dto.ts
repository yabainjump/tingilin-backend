import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** Champs texte du formulaire multipart (les valeurs arrivent en chaines). */
export class DeliveryProofDto {
  // L'admin certifie avoir l'accord du gagnant pour publier photo + temoignage.
  @IsIn(['true'], {
    message: "L'accord du gagnant est obligatoire pour publier la preuve",
  })
  consent!: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  testimonial?: string;
}
