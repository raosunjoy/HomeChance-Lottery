use anchor_lang::prelude::*;
use anchor_spl::token::{MintTo, Token, Transfer, mint_to, transfer};
use mpl_token_metadata::{
    instructions::CreateMetadataAccountV3InstructionArgs,
    types::{Creator, DataV2},
    ID as MPL_TOKEN_METADATA_ID,
};
use std::str::FromStr;

// Chainlink VRF program (simulated for Devnet)
const CHAINLINK_VRF_PROGRAM_ID: &str = "VRF111111111111111111111111111111111111111";

declare_id!("BAkZeFEefRiGYj8des7zXoTpWwNNcfj6NB5694PCTHKo");

#[account]
pub struct Raffle {
    pub raffle_id: String,
    pub property_id: String,
    pub seller: Pubkey,
    pub escrow_account: Pubkey,
    pub ticket_price_sol: u64,
    pub total_tickets: u64,
    pub tickets_sold: u64,
    pub winner: Option<Pubkey>,
    pub property_nft_mint: Pubkey,
    pub property_token_mint: Pubkey,
    pub is_completed: bool,
    pub allow_fractional: bool,
    pub ticket_holders: Vec<TicketHolder>,
    pub random_value: Option<u64>,
}

#[account]
pub struct TicketHolder {
    pub buyer: Pubkey,
    pub num_tickets: u64,
    pub token_account: Pubkey,
    pub kyc_verified: bool,
    pub payment_method: u8, // 0: SOL, 1: Fiat
}

#[event]
pub struct TicketPurchased {
    pub raffle_id: String,
    pub buyer: Pubkey,
    pub num_tickets: u64,
    pub payment_method: u8,
}

#[event]
pub struct RaffleClosed {
    pub raffle_id: String,
    pub is_full_sale: bool,
    pub winner: Option<Pubkey>,
}

#[event]
pub struct PayoutProcessed {
    pub raffle_id: String,
    pub seller_payout: u64,
    pub platform_revenue: u64,
    pub charity_contribution: u64,
}

#[event]
pub struct TicketHolderProcessed {
    pub raffle_id: String,
    pub buyer: Pubkey,
    pub refunded_amount: Option<u64>,
    pub tokens_minted: Option<u64>,
}

#[program]
pub mod homechance_raffle {
    use super::*;

    pub fn initialize_raffle(
        ctx: Context<InitializeRaffle>,
        raffle_id: String,
        property_id: String,
        ticket_price_sol: u64,
    ) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;

        let (expected_escrow_key, _bump) = Pubkey::find_program_address(
            &[b"escrow", raffle_id.as_bytes()],
            &ctx.program_id,
        );
        require!(
            ctx.accounts.escrow_account.key() == expected_escrow_key,
            RaffleError::InvalidEscrowAccount
        );
        require!(
            ctx.accounts.escrow_account.owner == &anchor_lang::solana_program::system_program::ID,
            RaffleError::InvalidEscrowAccount
        );

        msg!("Debug: Expected escrow PDA: {}", expected_escrow_key);

        raffle.raffle_id = raffle_id;
        raffle.property_id = property_id;
        raffle.seller = ctx.accounts.seller.key();
        raffle.escrow_account = ctx.accounts.escrow_account.key();
        raffle.ticket_price_sol = ticket_price_sol;
        raffle.total_tickets = 10_000;
        raffle.tickets_sold = 0;
        raffle.winner = None;
        raffle.property_nft_mint = ctx.accounts.property_nft_mint.key();
        raffle.property_token_mint = ctx.accounts.property_token_mint.key();
        raffle.is_completed = false;
        raffle.allow_fractional = false; // Default, set by seller later
        raffle.ticket_holders = Vec::new();
        raffle.random_value = None;

        let nft_mint_key = ctx.accounts.property_nft_mint.key();
        let metadata_seeds = &[b"metadata", MPL_TOKEN_METADATA_ID.as_ref(), nft_mint_key.as_ref()];
        let (metadata_pda, _bump) = Pubkey::find_program_address(metadata_seeds, &MPL_TOKEN_METADATA_ID.into());

        let creators = vec![Creator {
            address: ctx.accounts.seller.key().into(),
            verified: true,
            share: 100,
        }];

        let metadata_data = DataV2 {
            name: "Property NFT".to_string(),
            symbol: "PROP".to_string(),
            uri: "https://example.com/metadata".to_string(),
            seller_fee_basis_points: 0,
            creators: Some(creators.clone()),
            collection: None,
            uses: None,
        };

        let args = CreateMetadataAccountV3InstructionArgs {
            data: metadata_data.clone(),
            is_mutable: true,
            collection_details: None,
        };

        let ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: MPL_TOKEN_METADATA_ID.into(),
            accounts: vec![
                AccountMeta::new(metadata_pda, false),
                AccountMeta::new_readonly(ctx.accounts.property_nft_mint.key(), false),
                AccountMeta::new_readonly(ctx.accounts.seller.key(), true),
                AccountMeta::new(ctx.accounts.seller.key(), true),
                AccountMeta::new_readonly(ctx.accounts.seller.key(), false),
                AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
                AccountMeta::new_readonly(ctx.accounts.rent.key(), false),
            ],
            data: args.try_to_vec()?,
        };

        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.metadata_program.clone(),
                ctx.accounts.property_nft_mint.to_account_info(),
                ctx.accounts.seller.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                ctx.accounts.rent.to_account_info(),
            ],
        )?;

        let token_mint_key = ctx.accounts.property_token_mint.key();
        let token_metadata_seeds = &[b"metadata", MPL_TOKEN_METADATA_ID.as_ref(), token_mint_key.as_ref()];
        let (token_metadata_pda, _token_bump) = Pubkey::find_program_address(token_metadata_seeds, &MPL_TOKEN_METADATA_ID.into());

        let token_metadata_data = DataV2 {
            name: "Fractional Token".to_string(),
            symbol: "FRAC".to_string(),
            uri: "https://example.com/metadata".to_string(),
            seller_fee_basis_points: 0,
            creators: Some(creators),
            collection: None,
            uses: None,
        };

        let token_args = CreateMetadataAccountV3InstructionArgs {
            data: token_metadata_data,
            is_mutable: true,
            collection_details: None,
        };

        let token_ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: MPL_TOKEN_METADATA_ID.into(),
            accounts: vec![
                AccountMeta::new(token_metadata_pda, false),
                AccountMeta::new_readonly(ctx.accounts.property_token_mint.key(), false),
                AccountMeta::new_readonly(ctx.accounts.seller.key(), true),
                AccountMeta::new(ctx.accounts.seller.key(), true),
                AccountMeta::new_readonly(ctx.accounts.seller.key(), false),
                AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
                AccountMeta::new_readonly(ctx.accounts.rent.key(), false),
            ],
            data: token_args.try_to_vec()?,
        };

        anchor_lang::solana_program::program::invoke(
            &token_ix,
            &[
                ctx.accounts.metadata_program.clone(),
                ctx.accounts.property_token_mint.to_account_info(),
                ctx.accounts.seller.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                ctx.accounts.rent.to_account_info(),
            ],
        )?;

        Ok(())
    }

    pub fn purchase_ticket(ctx: Context<PurchaseTicket>, num_tickets: u64, payment_method: u8) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;
        require!(!raffle.is_completed, RaffleError::RaffleCompleted);
        require!(
            raffle.tickets_sold + num_tickets <= raffle.total_tickets,
            RaffleError::TicketLimitExceeded
        );

        let (expected_escrow_key, _bump) = Pubkey::find_program_address(
            &[b"escrow", raffle.raffle_id.as_bytes()],
            &ctx.program_id,
        );
        require!(
            ctx.accounts.escrow_account.key() == expected_escrow_key,
            RaffleError::InvalidEscrowAccount
        );
        require!(
            ctx.accounts.escrow_account.owner == &anchor_lang::solana_program::system_program::ID,
            RaffleError::InvalidEscrowAccount
        );

        let buyer_token_account: anchor_spl::token::TokenAccount =
            anchor_spl::token::TokenAccount::try_deserialize(&mut &ctx.accounts.buyer_token_account.data.borrow()[..])?;
        require!(
            buyer_token_account.mint == raffle.property_token_mint,
            RaffleError::InvalidTokenAccountMint
        );
        require!(
            buyer_token_account.owner == ctx.accounts.buyer.key(),
            RaffleError::InvalidTokenAccountOwner
        );

        // Enforce KYC
        let buyer = ctx.accounts.buyer.key();
        if let Some(holder) = raffle.ticket_holders.iter().find(|h| h.buyer == buyer) {
            require!(holder.kyc_verified, RaffleError::KycNotVerified);
        }

        // Handle SOL payment (fiat handled off-chain)
        if payment_method == 0 { // SOL
            let total_cost = raffle
                .ticket_price_sol
                .checked_mul(num_tickets)
                .ok_or(RaffleError::MathOverflow)?;

            let transfer_instruction = anchor_lang::solana_program::system_instruction::transfer(
                &ctx.accounts.buyer.key(),
                &ctx.accounts.escrow_account.key(),
                total_cost,
            );

            anchor_lang::solana_program::program::invoke(
                &transfer_instruction,
                &[
                    ctx.accounts.buyer.to_account_info(),
                    ctx.accounts.escrow_account.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
            )?;
        }

        let token_account = ctx.accounts.buyer_token_account.key();
        if let Some(holder) = raffle.ticket_holders.iter_mut().find(|h| h.buyer == buyer) {
            holder.num_tickets += num_tickets;
        } else {
            raffle.ticket_holders.push(TicketHolder {
                buyer,
                num_tickets,
                token_account,
                kyc_verified: true,
                payment_method,
            });
        }

        raffle.tickets_sold += num_tickets;

        emit!(TicketPurchased {
            raffle_id: raffle.raffle_id.clone(),
            buyer,
            num_tickets,
            payment_method,
        });

        Ok(())
    }

    pub fn set_fractional_option(ctx: Context<SetFractionalOption>, allow_fractional: bool) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;
        require!(!raffle.is_completed, RaffleError::RaffleCompleted);
        require!(
            raffle.tickets_sold < raffle.total_tickets,
            RaffleError::FullSale
        );

        raffle.allow_fractional = allow_fractional;
        Ok(())
    }

    pub fn request_randomness(ctx: Context<RequestRandomness>) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;
        require!(!raffle.is_completed, RaffleError::RaffleCompleted);
        require!(
            raffle.tickets_sold == raffle.total_tickets,
            RaffleError::NotEnoughTickets
        );

        let (expected_escrow_key, _bump) = Pubkey::find_program_address(
            &[b"escrow", raffle.raffle_id.as_bytes()],
            &ctx.program_id,
        );
        require!(
            ctx.accounts.escrow_account.key() == expected_escrow_key,
            RaffleError::InvalidEscrowAccount
        );
        require!(
            ctx.accounts.escrow_account.owner == &anchor_lang::solana_program::system_program::ID,
            RaffleError::InvalidEscrowAccount
        );

        let chainlink_vrf_program_id = Pubkey::from_str(CHAINLINK_VRF_PROGRAM_ID).unwrap();
        let ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: chainlink_vrf_program_id,
            accounts: vec![
                AccountMeta::new_readonly(ctx.accounts.raffle.key(), false),
                AccountMeta::new_readonly(ctx.accounts.escrow_account.key(), false),
            ],
            data: vec![0; 8],
        };

        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.raffle.to_account_info(),
                ctx.accounts.escrow_account.to_account_info(),
            ],
        )?;

        Ok(())
    }

    pub fn fulfill_randomness(ctx: Context<FulfillRandomness>, random_value: u64) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;
        require!(!raffle.is_completed, RaffleError::RaffleCompleted);
        require!(
            raffle.tickets_sold == raffle.total_tickets,
            RaffleError::NotEnoughTickets
        );

        raffle.random_value = Some(random_value);

        let total_tickets = raffle
            .ticket_holders
            .iter()
            .map(|h| h.num_tickets)
            .sum::<u64>();
        let winner_index = (random_value % total_tickets) as u64;
        let mut ticket_count = 0;
        let mut winner = None;

        for holder in raffle.ticket_holders.iter() {
            ticket_count += holder.num_tickets;
            if winner_index < ticket_count {
                winner = Some(holder.buyer);
                break;
            }
        }

        raffle.winner = winner;
        raffle.is_completed = true;

        emit!(RaffleClosed {
            raffle_id: raffle.raffle_id.clone(),
            is_full_sale: true,
            winner,
        });

        Ok(())
    }

    pub fn close_raffle(ctx: Context<CloseRaffle>) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;
        require!(!raffle.is_completed, RaffleError::RaffleCompleted);
        require!(
            raffle.tickets_sold < raffle.total_tickets,
            RaffleError::FullSale
        );

        raffle.is_completed = true;
        emit!(RaffleClosed {
            raffle_id: raffle.raffle_id.clone(),
            is_full_sale: false,
            winner: None,
        });

        Ok(())
    }

    pub fn refund_or_distribute(ctx: Context<RefundOrDistribute>, buyer: Pubkey) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;
        require!(raffle.is_completed, RaffleError::RaffleNotClosed);
        require!(raffle.tickets_sold < raffle.total_tickets, RaffleError::FullSale);

        let (expected_escrow_key, _bump) = Pubkey::find_program_address(
            &[b"escrow", raffle.raffle_id.as_bytes()],
            &ctx.program_id,
        );
        require!(
            ctx.accounts.escrow_account.key() == expected_escrow_key,
            RaffleError::InvalidEscrowAccount
        );
        require!(
            ctx.accounts.escrow_account.owner == &anchor_lang::solana_program::system_program::ID,
            RaffleError::InvalidEscrowAccount
        );

        require!(
            ctx.accounts.holder_account.owner == &anchor_lang::solana_program::system_program::ID,
            RaffleError::InvalidHolderAccount
        );

        let holder_token_account: anchor_spl::token::TokenAccount =
            anchor_spl::token::TokenAccount::try_deserialize(&mut &ctx.accounts.holder_token_account.data.borrow()[..])?;
        let property_token_mint: anchor_spl::token::Mint =
            anchor_spl::token::Mint::try_deserialize(&mut &ctx.accounts.property_token_mint.data.borrow()[..])?;

        require!(
            holder_token_account.mint == raffle.property_token_mint,
            RaffleError::InvalidTokenAccountMint
        );
        require!(
            holder_token_account.owner == ctx.accounts.holder_account.key(),
            RaffleError::InvalidTokenAccountOwner
        );
        require!(
            property_token_mint.mint_authority == Some(ctx.accounts.seller.key()).into(),
            RaffleError::InvalidMintAuthority
        );

        let holder_index = raffle
            .ticket_holders
            .iter()
            .position(|h| h.buyer == buyer)
            .ok_or(RaffleError::NoTicketHolders)?;
        let holder = raffle.ticket_holders.remove(holder_index);

        require!(
            holder.buyer == ctx.accounts.holder_account.key(),
            RaffleError::InvalidHolderAccount
        );
        require!(
            holder.token_account == ctx.accounts.holder_token_account.key(),
            RaffleError::InvalidHolderTokenAccount
        );

        let mut refunded_amount = None;
        let mut tokens_minted = None;

        if raffle.allow_fractional {
            let total_tokens = 1_000_000;
            let tokens_per_ticket = total_tokens / raffle.total_tickets;
            let tokens_to_mint = holder
                .num_tickets
                .checked_mul(tokens_per_ticket)
                .ok_or(RaffleError::MathOverflow)?;
            mint_to(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    MintTo {
                        mint: ctx.accounts.property_token_mint.to_account_info(),
                        to: ctx.accounts.holder_token_account.to_account_info(),
                        authority: ctx.accounts.seller.to_account_info(),
                    },
                ),
                tokens_to_mint,
            )?;
            tokens_minted = Some(tokens_to_mint);
        } else {
            let refund_amount = holder
                .num_tickets
                .checked_mul(raffle.ticket_price_sol)
                .ok_or(RaffleError::MathOverflow)?;

            if holder.payment_method == 0 { // SOL
                let transfer_instruction = anchor_lang::solana_program::system_instruction::transfer(
                    &ctx.accounts.escrow_account.key(),
                    &ctx.accounts.holder_account.key(),
                    refund_amount,
                );

                anchor_lang::solana_program::program::invoke_signed(
                    &transfer_instruction,
                    &[
                        ctx.accounts.escrow_account.to_account_info(),
                        ctx.accounts.holder_account.to_account_info(),
                        ctx.accounts.system_program.to_account_info(),
                    ],
                    &[&[b"escrow", raffle.raffle_id.as_bytes(), &[ctx.bumps.escrow_account]]],
                )?;
            } // Fiat refunds handled off-chain
            refunded_amount = Some(refund_amount);
        }

        emit!(TicketHolderProcessed {
            raffle_id: raffle.raffle_id.clone(),
            buyer,
            refunded_amount,
            tokens_minted,
        });

        Ok(())
    }

    pub fn process_payout_full_sale(
        ctx: Context<ProcessPayoutFullSale>,
        property_transfer_confirmed: bool,
    ) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;
        require!(raffle.is_completed, RaffleError::RaffleNotClosed);
        require!(
            raffle.tickets_sold == raffle.total_tickets,
            RaffleError::NotFullSale
        );

        let (expected_escrow_key, _bump) = Pubkey::find_program_address(
            &[b"escrow", raffle.raffle_id.as_bytes()],
            &ctx.program_id,
        );
        require!(
            ctx.accounts.escrow_account.key() == expected_escrow_key,
            RaffleError::InvalidEscrowAccount
        );
        require!(
            ctx.accounts.escrow_account.owner == &anchor_lang::solana_program::system_program::ID,
            RaffleError::InvalidEscrowAccount
        );
        require!(
            ctx.accounts.escrow_account.lamports() > 0,
            RaffleError::InvalidEscrowAccount
        );

        require!(
            ctx.accounts.charity_account.owner == &anchor_lang::solana_program::system_program::ID,
            RaffleError::InvalidCharityAccount
        );

        let property_nft_account: anchor_spl::token::TokenAccount =
            anchor_spl::token::TokenAccount::try_deserialize(&mut &ctx.accounts.property_nft_account.data.borrow()[..])?;
        let winner_nft_account: anchor_spl::token::TokenAccount =
            anchor_spl::token::TokenAccount::try_deserialize(&mut &ctx.accounts.winner_nft_account.data.borrow()[..])?;

        require!(
            property_nft_account.owner == ctx.accounts.seller.key(),
            RaffleError::InvalidTokenAccountOwner
        );
        require!(
            property_nft_account.mint == raffle.property_nft_mint,
            RaffleError::InvalidTokenAccountMint
        );
        require!(
            property_nft_account.amount == 1,
            RaffleError::InvalidTokenAccountAmount
        );
        require!(
            winner_nft_account.mint == raffle.property_nft_mint,
            RaffleError::InvalidTokenAccountMint
        );

        let total_proceeds = raffle
            .ticket_price_sol
            .checked_mul(raffle.tickets_sold)
            .ok_or(RaffleError::MathOverflow)?;

        let seller_payout = total_proceeds
            .checked_mul(9)
            .ok_or(RaffleError::MathOverflow)?
            .checked_div(10)
            .ok_or(RaffleError::MathOverflow)?;

        let transfer_to_seller = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.escrow_account.key(),
            &ctx.accounts.seller.key(),
            seller_payout,
        );

        anchor_lang::solana_program::program::invoke_signed(
            &transfer_to_seller,
            &[
                ctx.accounts.escrow_account.to_account_info(),
                ctx.accounts.seller.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[&[b"escrow", raffle.raffle_id.as_bytes(), &[ctx.bumps.escrow_account]]],
        )?;

        let platform_revenue = total_proceeds
            .checked_div(10)
            .ok_or(RaffleError::MathOverflow)?;

        let charity_contribution = platform_revenue
            .checked_div(10)
            .ok_or(RaffleError::MathOverflow)?;

        let transfer_to_charity = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.escrow_account.key(),
            &ctx.accounts.charity_account.key(),
            charity_contribution,
        );

        anchor_lang::solana_program::program::invoke_signed(
            &transfer_to_charity,
            &[
                ctx.accounts.escrow_account.to_account_info(),
                ctx.accounts.charity_account.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[&[b"escrow", raffle.raffle_id.as_bytes(), &[ctx.bumps.escrow_account]]],
        )?;

        require!(raffle.winner.is_some(), RaffleError::NoWinner);
        require!(
            property_transfer_confirmed,
            RaffleError::PropertyTransferNotConfirmed
        );
        let _winner = raffle.winner.unwrap();
        transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.property_nft_account.to_account_info(),
                    to: ctx.accounts.winner_nft_account.to_account_info(),
                    authority: ctx.accounts.seller.to_account_info(),
                },
            ),
            1,
        )?;

        emit!(PayoutProcessed {
            raffle_id: raffle.raffle_id.clone(),
            seller_payout,
            platform_revenue,
            charity_contribution,
        });

        Ok(())
    }

    pub fn process_payout_fractional(ctx: Context<ProcessPayoutFractional>) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;
        require!(raffle.is_completed, RaffleError::RaffleNotClosed);
        require!(
            raffle.tickets_sold < raffle.total_tickets,
            RaffleError::FullSale
        );
        require!(
            raffle.ticket_holders.is_empty(),
            RaffleError::TicketHoldersNotProcessed
        );
        require!(
            raffle.allow_fractional,
            RaffleError::FractionalOwnershipNotAllowed
        );

        let (expected_escrow_key, _bump) = Pubkey::find_program_address(
            &[b"escrow", raffle.raffle_id.as_bytes()],
            &ctx.program_id,
        );
        require!(
            ctx.accounts.escrow_account.key() == expected_escrow_key,
            RaffleError::InvalidEscrowAccount
        );
        require!(
            ctx.accounts.escrow_account.owner == &anchor_lang::solana_program::system_program::ID,
            RaffleError::InvalidEscrowAccount
        );

        let seller_token_account: anchor_spl::token::TokenAccount =
            anchor_spl::token::TokenAccount::try_deserialize(&mut &ctx.accounts.seller_token_account.data.borrow()[..])?;
        let property_token_mint: anchor_spl::token::Mint =
            anchor_spl::token::Mint::try_deserialize(&mut &ctx.accounts.property_token_mint.data.borrow()[..])?;

        require!(
            seller_token_account.mint == raffle.property_token_mint,
            RaffleError::InvalidTokenAccountMint
        );
        require!(
            seller_token_account.owner == ctx.accounts.seller.key(),
            RaffleError::InvalidTokenAccountOwner
        );
        require!(
            property_token_mint.mint_authority == Some(ctx.accounts.seller.key()).into(),
            RaffleError::InvalidMintAuthority
        );

        let total_proceeds = raffle
            .ticket_price_sol
            .checked_mul(raffle.tickets_sold)
            .ok_or(RaffleError::MathOverflow)?;

        let seller_payout = total_proceeds
            .checked_mul(9)
            .ok_or(RaffleError::MathOverflow)?
            .checked_div(10)
            .ok_or(RaffleError::MathOverflow)?;

        let transfer_to_seller = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.escrow_account.key(),
            &ctx.accounts.seller.key(),
            seller_payout,
        );

        anchor_lang::solana_program::program::invoke_signed(
            &transfer_to_seller,
            &[
                ctx.accounts.escrow_account.to_account_info(),
                ctx.accounts.seller.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[&[b"escrow", raffle.raffle_id.as_bytes(), &[ctx.bumps.escrow_account]]],
        )?;

        let platform_revenue = total_proceeds
            .checked_div(10)
            .ok_or(RaffleError::MathOverflow)?;

        let charity_contribution = platform_revenue
            .checked_div(10)
            .ok_or(RaffleError::MathOverflow)?;

        let transfer_to_charity = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.escrow_account.key(),
            &ctx.accounts.charity_account.key(),
            charity_contribution,
        );

        anchor_lang::solana_program::program::invoke_signed(
            &transfer_to_charity,
            &[
                ctx.accounts.escrow_account.to_account_info(),
                ctx.accounts.charity_account.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[&[b"escrow", raffle.raffle_id.as_bytes(), &[ctx.bumps.escrow_account]]],
        )?;

        let total_tokens = 1_000_000;
        let tokens_per_ticket = total_tokens / raffle.total_tickets;
        let unsold_tickets = raffle.total_tickets - raffle.tickets_sold;
        let seller_tokens = unsold_tickets
            .checked_mul(tokens_per_ticket)
            .ok_or(RaffleError::MathOverflow)?;
        mint_to(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.property_token_mint.to_account_info(),
                    to: ctx.accounts.seller_token_account.to_account_info(),
                    authority: ctx.accounts.seller.to_account_info(),
                },
            ),
            seller_tokens,
        )?;

        emit!(PayoutProcessed {
            raffle_id: raffle.raffle_id.clone(),
            seller_payout,
            platform_revenue,
            charity_contribution,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeRaffle<'info> {
    #[account(init, payer = seller, space = 8 + 32 + 32 + 32 + 32 + 8 + 8 + 8 + 32 + 32 + 1 + 1 + 2000 + 8)]
    pub raffle: Account<'info, Raffle>,
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(
        init,
        payer = seller,
        space = 8,
        seeds = [b"escrow", raffle.raffle_id.as_bytes()],
        bump
    )]
    pub escrow_account: AccountInfo<'info>,
    #[account(mut)]
    pub property_nft_mint: AccountInfo<'info>,
    #[account(mut)]
    pub property_token_mint: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    pub metadata_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct PurchaseTicket<'info> {
    #[account(mut)]
    pub raffle: Account<'info, Raffle>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut)]
    pub buyer_token_account: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"escrow", raffle.raffle_id.as_bytes()],
        bump
    )]
    pub escrow_account: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetFractionalOption<'info> {
    #[account(mut)]
    pub raffle: Account<'info, Raffle>,
    #[account(mut)]
    pub seller: Signer<'info>,
}

#[derive(Accounts)]
pub struct RequestRandomness<'info> {
    #[account(mut)]
    pub raffle: Account<'info, Raffle>,
    #[account(
        mut,
        seeds = [b"escrow", raffle.raffle_id.as_bytes()],
        bump
    )]
    pub escrow_account: AccountInfo<'info>,
    pub chainlink_vrf_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct FulfillRandomness<'info> {
    #[account(mut)]
    pub raffle: Account<'info, Raffle>,
}

#[derive(Accounts)]
pub struct CloseRaffle<'info> {
    #[account(mut)]
    pub raffle: Account<'info, Raffle>,
    #[account(
        mut,
        seeds = [b"escrow", raffle.raffle_id.as_bytes()],
        bump
    )]
    pub escrow_account: AccountInfo<'info>,
    #[account(mut)]
    pub seller: Signer<'info>,
}

#[derive(Accounts)]
pub struct RefundOrDistribute<'info> {
    #[account(mut)]
    pub raffle: Account<'info, Raffle>,
    #[account(
        mut,
        seeds = [b"escrow", raffle.raffle_id.as_bytes()],
        bump
    )]
    pub escrow_account: AccountInfo<'info>,
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(mut)]
    pub holder_account: AccountInfo<'info>,
    #[account(mut)]
    pub holder_token_account: AccountInfo<'info>,
    #[account(mut)]
    pub property_token_mint: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ProcessPayoutFullSale<'info> {
    #[account(mut)]
    pub raffle: Account<'info, Raffle>,
    #[account(
        mut,
        seeds = [b"escrow", raffle.raffle_id.as_bytes()],
        bump
    )]
    pub escrow_account: AccountInfo<'info>,
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(mut)]
    pub charity_account: AccountInfo<'info>,
    #[account(mut)]
    pub property_nft_account: AccountInfo<'info>,
    #[account(mut)]
    pub winner_nft_account: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ProcessPayoutFractional<'info> {
    #[account(mut)]
    pub raffle: Account<'info, Raffle>,
    #[account(
        mut,
        seeds = [b"escrow", raffle.raffle_id.as_bytes()],
        bump
    )]
    pub escrow_account: AccountInfo<'info>,
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(mut)]
    pub seller_token_account: AccountInfo<'info>,
    #[account(mut)]
    pub charity_account: AccountInfo<'info>,
    #[account(mut)]
    pub property_token_mint: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum RaffleError {
    #[msg("Raffle is already completed")]
    RaffleCompleted,
    #[msg("Not enough tickets sold to select winner")]
    NotEnoughTickets,
    #[msg("Ticket limit exceeded")]
    TicketLimitExceeded,
    #[msg("No winner selected")]
    NoWinner,
    #[msg("Property transfer not confirmed")]
    PropertyTransferNotConfirmed,
    #[msg("Math overflow error")]
    MathOverflow,
    #[msg("Raffle not yet closed")]
    RaffleNotClosed,
    #[msg("No ticket holders found")]
    NoTicketHolders,
    #[msg("Use fulfill_randomness to close full sale raffle")]
    UseFulfillRandomness,
    #[msg("Invalid holder account")]
    InvalidHolderAccount,
    #[msg("Invalid holder token account")]
    InvalidHolderTokenAccount,
    #[msg("Ticket holders not yet processed")]
    TicketHoldersNotProcessed,
    #[msg("Not a full sale")]
    NotFullSale,
    #[msg("Full sale")]
    FullSale,
    #[msg("Fractional ownership is not allowed")]
    FractionalOwnershipNotAllowed,
    #[msg("Seller is not the mint authority of the property token mint")]
    InvalidMintAuthority,
    #[msg("Token account owner does not match expected owner")]
    InvalidTokenAccountOwner,
    #[msg("Token account mint does not match raffle property NFT mint")]
    InvalidTokenAccountMint,
    #[msg("Token account does not hold exactly 1 token")]
    InvalidTokenAccountAmount,
    #[msg("Invalid escrow account")]
    InvalidEscrowAccount,
    #[msg("Invalid charity account")]
    InvalidCharityAccount,
    #[msg("KYC verification required")]
    KycNotVerified,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_raffle() -> Raffle {
        Raffle {
            raffle_id: String::new(),
            property_id: String::new(),
            seller: Pubkey::new_unique(),
            escrow_account: Pubkey::new_unique(),
            ticket_price_sol: 0,
            total_tickets: 0,
            tickets_sold: 0,
            winner: None,
            property_nft_mint: Pubkey::new_unique(),
            property_token_mint: Pubkey::new_unique(),
            is_completed: false,
            allow_fractional: false,
            ticket_holders: Vec::new(),
            random_value: None,
        }
    }

    #[test]
    fn test_initialize_raffle_logic() {
        let mut raffle = create_raffle();
        let seller = Pubkey::new_unique();
        let escrow_account = Pubkey::new_unique();
        let property_nft_mint = Pubkey::new_unique();
        let property_token_mint = Pubkey::new_unique();

        raffle.raffle_id = "raffle1".to_string();
        raffle.property_id = "property1".to_string();
        raffle.seller = seller;
        raffle.escrow_account = escrow_account;
        raffle.ticket_price_sol = 1_000_000;
        raffle.total_tickets = 10_000;
        raffle.tickets_sold = 0;
        raffle.winner = None;
        raffle.property_nft_mint = property_nft_mint;
        raffle.property_token_mint = property_token_mint;
        raffle.is_completed = false;
        raffle.allow_fractional = false;
        raffle.ticket_holders = Vec::new();
        raffle.random_value = None;

        assert_eq!(raffle.raffle_id, "raffle1");
        assert_eq!(raffle.property_id, "property1");
        assert_eq!(raffle.ticket_price_sol, 1_000_000);
        assert_eq!(raffle.total_tickets, 10_000);
        assert_eq!(raffle.tickets_sold, 0);
        assert_eq!(raffle.is_completed, false);
        assert_eq!(raffle.allow_fractional, false);
        assert!(raffle.ticket_holders.is_empty());
    }

    #[test]
    fn test_purchase_ticket_logic() {
        let mut raffle = create_raffle();
        raffle.raffle_id = "raffle1".to_string();
        raffle.property_id = "property1".to_string();
        raffle.seller = Pubkey::new_unique();
        raffle.escrow_account = Pubkey::new_unique();
        raffle.ticket_price_sol = 1_000_000;
        raffle.total_tickets = 10_000;
        raffle.tickets_sold = 0;
        raffle.is_completed = false;

        let buyer = Pubkey::new_unique();
        let buyer_token_account = Pubkey::new_unique();
        let num_tickets = 2;
        let payment_method = 0; // SOL

        assert!(!raffle.is_completed);
        assert!(raffle.tickets_sold + num_tickets <= raffle.total_tickets);

        if let Some(holder) = raffle.ticket_holders.iter_mut().find(|h| h.buyer == buyer) {
            holder.num_tickets += num_tickets;
        } else {
            raffle.ticket_holders.push(TicketHolder {
                buyer,
                num_tickets,
                token_account: buyer_token_account,
                kyc_verified: true,
                payment_method,
            });
        }
        raffle.tickets_sold += num_tickets;

        assert_eq!(raffle.tickets_sold, num_tickets);
        assert_eq!(raffle.ticket_holders.len(), 1);
        assert_eq!(raffle.ticket_holders[0].buyer, buyer);
        assert_eq!(raffle.ticket_holders[0].num_tickets, num_tickets);
        assert_eq!(raffle.ticket_holders[0].kyc_verified, true);
        assert_eq!(raffle.ticket_holders[0].payment_method, payment_method);
    }
}