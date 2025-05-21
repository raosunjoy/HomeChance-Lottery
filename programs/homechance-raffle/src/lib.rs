use anchor_lang::prelude::*;
use anchor_spl::token::{MintTo, Token, Transfer, mint_to, transfer};
use mpl_token_metadata::{
    instructions::CreateMetadataAccountV3InstructionArgs,
    types::{Creator, DataV2},
    ID as MPL_TOKEN_METADATA_ID,
};
use std::str::FromStr;

// Chainlink VRF program (simulated for Devnet)
const CHAINLINK_VRF_PROGRAM_ID: &str = "VRF111111111111111111111111111111111111111"; // Placeholder for Devnet

declare_id!("BAkZeFEefRiGYj8des7zXoTpWwNNcfj6NB5694PCTHKo");

// Raffle state
#[account]
pub struct Raffle {
    pub raffle_id: String,
    pub property_id: String,
    pub seller: Pubkey,
    pub escrow_account: Pubkey,
    pub ticket_price_sol: u64, // in lamports
    pub total_tickets: u64,    // fixed at 10,000
    pub tickets_sold: u64,
    pub winner: Option<Pubkey>,
    pub property_nft_mint: Pubkey,   // NFT for full ownership
    pub property_token_mint: Pubkey, // SPL Token for fractional ownership
    pub is_completed: bool,
    pub allow_fractional: bool, // Seller approval for fractional ownership
    pub ticket_holders: Vec<TicketHolder>, // Track ticket holders
    pub random_value: Option<u64>, // Store Chainlink VRF random value
}

#[account]
pub struct TicketHolder {
    pub buyer: Pubkey,
    pub num_tickets: u64,
    pub token_account: Pubkey, // Token account to receive fractional tokens
}

// Events for off-chain tracking (Helius-compatible)
#[event]
pub struct TicketPurchased {
    pub raffle_id: String,
    pub buyer: Pubkey,
    pub num_tickets: u64,
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

    // Initialize a new raffle
    pub fn initialize_raffle(
        ctx: Context<InitializeRaffle>,
        raffle_id: String,
        property_id: String,
        ticket_price_sol: u64,
        allow_fractional: bool,
        property_name: String,
        property_symbol: String,
        property_uri: String,
    ) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;

        // Validate escrow_account
        let expected_escrow_key = Pubkey::find_program_address(
            &[b"escrow", raffle_id.as_bytes()],
            &ctx.program_id,
        ).0;
        require!(
            ctx.accounts.escrow_account.key() == expected_escrow_key,
            RaffleError::InvalidEscrowAccount
        );
        require!(
            ctx.accounts.escrow_account.owner == &anchor_lang::solana_program::system_program::ID,
            RaffleError::InvalidEscrowAccount
        );

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
        raffle.allow_fractional = allow_fractional;
        raffle.ticket_holders = Vec::new();
        raffle.random_value = None;

        // Create Metaplex metadata for property NFT
        let nft_mint_key = ctx.accounts.property_nft_mint.key();
        let metadata_seeds = &[
            b"metadata",
            MPL_TOKEN_METADATA_ID.as_ref(),
            nft_mint_key.as_ref(),
        ];
        let (metadata_pda, _bump) =
            Pubkey::find_program_address(metadata_seeds, &MPL_TOKEN_METADATA_ID.into());

        let creators = vec![Creator {
            address: ctx.accounts.seller.key().into(),
            verified: true,
            share: 100,
        }];

        let metadata_data = DataV2 {
            name: property_name.clone(),
            symbol: property_symbol.clone(),
            uri: property_uri.clone(),
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

        // Create Metaplex metadata for fractional token
        let token_mint_key = ctx.accounts.property_token_mint.key();
        let token_metadata_seeds = &[
            b"metadata",
            MPL_TOKEN_METADATA_ID.as_ref(),
            token_mint_key.as_ref(),
        ];
        let (token_metadata_pda, _token_bump) =
            Pubkey::find_program_address(token_metadata_seeds, &MPL_TOKEN_METADATA_ID.into());

        let token_metadata_data = DataV2 {
            name: format!("{} Fractional Token", property_name),
            symbol: format!("{}-FRAC", property_symbol),
            uri: property_uri,
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

    // Buyer purchases a ticket
    pub fn purchase_ticket(ctx: Context<PurchaseTicket>, num_tickets: u64) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;
        require!(!raffle.is_completed, RaffleError::RaffleCompleted);
        require!(
            raffle.tickets_sold + num_tickets <= raffle.total_tickets,
            RaffleError::TicketLimitExceeded
        );

        // Validate escrow_account
        let expected_escrow_key = Pubkey::find_program_address(
            &[b"escrow", raffle.raffle_id.as_bytes()],
            &ctx.program_id,
        ).0;
        require!(
            ctx.accounts.escrow_account.key() == expected_escrow_key,
            RaffleError::InvalidEscrowAccount
        );
        require!(
            ctx.accounts.escrow_account.owner == &anchor_lang::solana_program::system_program::ID,
            RaffleError::InvalidEscrowAccount
        );

        // Deserialize and validate buyer_token_account
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

        // Transfer SOL to escrow account
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

        // Record ticket holder
        let buyer = ctx.accounts.buyer.key();
        let token_account = ctx.accounts.buyer_token_account.key();
        if let Some(holder) = raffle.ticket_holders.iter_mut().find(|h| h.buyer == buyer) {
            holder.num_tickets += num_tickets;
        } else {
            raffle.ticket_holders.push(TicketHolder {
                buyer,
                num_tickets,
                token_account,
            });
        }

        raffle.tickets_sold += num_tickets;

        // Emit event for off-chain tracking (Helius)
        emit!(TicketPurchased {
            raffle_id: raffle.raffle_id.clone(),
            buyer,
            num_tickets,
        });

        Ok(())
    }

    // Request randomness from Chainlink VRF
    pub fn request_randomness(ctx: Context<RequestRandomness>) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;
        require!(!raffle.is_completed, RaffleError::RaffleCompleted);
        require!(
            raffle.tickets_sold == raffle.total_tickets,
            RaffleError::NotEnoughTickets
        );

        // Validate escrow_account
        let expected_escrow_key = Pubkey::find_program_address(
            &[b"escrow", raffle.raffle_id.as_bytes()],
            &ctx.program_id,
        ).0;
        require!(
            ctx.accounts.escrow_account.key() == expected_escrow_key,
            RaffleError::InvalidEscrowAccount
        );
        require!(
            ctx.accounts.escrow_account.owner == &anchor_lang::solana_program::system_program::ID,
            RaffleError::InvalidEscrowAccount
        );

        // Simulate Chainlink VRF request (in production, this would interact with Chainlink VRF program)
        let chainlink_vrf_program_id = Pubkey::from_str(CHAINLINK_VRF_PROGRAM_ID).unwrap();
        let ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: chainlink_vrf_program_id,
            accounts: vec![
                AccountMeta::new_readonly(ctx.accounts.raffle.key(), false),
                AccountMeta::new_readonly(ctx.accounts.escrow_account.key(), false),
            ],
            data: vec![0; 8], // Placeholder data for VRF request
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

    // Callback to handle Chainlink VRF response
    pub fn fulfill_randomness(ctx: Context<FulfillRandomness>, random_value: u64) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;
        require!(!raffle.is_completed, RaffleError::RaffleCompleted);
        require!(
            raffle.tickets_sold == raffle.total_tickets,
            RaffleError::NotEnoughTickets
        );

        raffle.random_value = Some(random_value);

        // Select winner using random value
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

    // Close raffle: Mark as completed and prepare for distribution
    pub fn close_raffle(ctx: Context<CloseRaffle>) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;
        require!(!raffle.is_completed, RaffleError::RaffleCompleted);

        // Validate escrow_account
        let expected_escrow_key = Pubkey::find_program_address(
            &[b"escrow", raffle.raffle_id.as_bytes()],
            &ctx.program_id,
        ).0;
        require!(
            ctx.accounts.escrow_account.key() == expected_escrow_key,
            RaffleError::InvalidEscrowAccount
        );
        require!(
            ctx.accounts.escrow_account.owner == &anchor_lang::solana_program::system_program::ID,
            RaffleError::InvalidEscrowAccount
        );

        let is_full_sale = raffle.tickets_sold == raffle.total_tickets;
        if is_full_sale {
            // Full sale: Winner selection handled by fulfill_randomness
            return Err(RaffleError::UseFulfillRandomness.into());
        }

        raffle.is_completed = true;
        emit!(RaffleClosed {
            raffle_id: raffle.raffle_id.clone(),
            is_full_sale: false,
            winner: None,
        });

        Ok(())
    }

    // Process a single ticket holder: Refund SOL or mint fractional tokens
    pub fn refund_or_distribute(ctx: Context<RefundOrDistribute>, buyer: Pubkey) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;
        require!(raffle.is_completed, RaffleError::RaffleNotClosed);
        require!(raffle.tickets_sold != raffle.total_tickets, RaffleError::UseFulfillRandomness);

        // Validate escrow_account
        let expected_escrow_key = Pubkey::find_program_address(
            &[b"escrow", raffle.raffle_id.as_bytes()],
            &ctx.program_id,
        ).0;
        require!(
            ctx.accounts.escrow_account.key() == expected_escrow_key,
            RaffleError::InvalidEscrowAccount
        );
        require!(
            ctx.accounts.escrow_account.owner == &anchor_lang::solana_program::system_program::ID,
            RaffleError::InvalidEscrowAccount
        );

        // Validate holder_account
        require!(
            ctx.accounts.holder_account.owner == &anchor_lang::solana_program::system_program::ID,
            RaffleError::InvalidHolderAccount
        );

        // Deserialize and validate accounts
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
                &[
                    &[b"escrow", raffle.raffle_id.as_bytes(), &[ctx.bumps.escrow_account]],
                ],
            )?;
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

    // Process payout for a full sale (transfer NFT to winner)
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

        // Validate escrow_account
        let expected_escrow_key = Pubkey::find_program_address(
            &[b"escrow", raffle.raffle_id.as_bytes()],
            &ctx.program_id,
        ).0;
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

        // Validate charity_account
        require!(
            ctx.accounts.charity_account.owner == &anchor_lang::solana_program::system_program::ID,
            RaffleError::InvalidCharityAccount
        );

        // Deserialize token accounts
        let property_nft_account: anchor_spl::token::TokenAccount =
            anchor_spl::token::TokenAccount::try_deserialize(&mut &ctx.accounts.property_nft_account.data.borrow()[..])?;
        let winner_nft_account: anchor_spl::token::TokenAccount =
            anchor_spl::token::TokenAccount::try_deserialize(&mut &ctx.accounts.winner_nft_account.data.borrow()[..])?;

        // Validate accounts
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

        // Seller payout: 90% of proceeds
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
            &[
                &[b"escrow", raffle.raffle_id.as_bytes(), &[ctx.bumps.escrow_account]],
            ],
        )?;

        // Platform revenue: 10% of proceeds
        let platform_revenue = total_proceeds
            .checked_div(10)
            .ok_or(RaffleError::MathOverflow)?;

        // Charity contribution: 10% of platform revenue (1% of total proceeds)
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
            &[
                &[b"escrow", raffle.raffle_id.as_bytes(), &[ctx.bumps.escrow_account]],
            ],
        )?;

        // Transfer property NFT to winner
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

    // Process payout for a fractional sale without minting tokens (allow_fractional = false)
    pub fn process_payout_fractional_no_mint(ctx: Context<ProcessPayoutFractionalNoMint>) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;
        require!(raffle.is_completed, RaffleError::RaffleNotClosed);
        require!(
            raffle.tickets_sold != raffle.total_tickets,
            RaffleError::FullSale
        );
        require!(
            raffle.ticket_holders.is_empty(),
            RaffleError::TicketHoldersNotProcessed
        );
        require!(
            !raffle.allow_fractional,
            RaffleError::FractionalOwnershipAllowed
        );

        // Validate escrow_account
        let expected_escrow_key = Pubkey::find_program_address(
            &[b"escrow", raffle.raffle_id.as_bytes()],
            &ctx.program_id,
        ).0;
        require!(
            ctx.accounts.escrow_account.key() == expected_escrow_key,
            RaffleError::InvalidEscrowAccount
        );
        require!(
            ctx.accounts.escrow_account.owner == &anchor_lang::solana_program::system_program::ID,
            RaffleError::InvalidEscrowAccount
        );

        // Validate charity_account
        require!(
            ctx.accounts.charity_account.owner == &anchor_lang::solana_program::system_program::ID,
            RaffleError::InvalidCharityAccount
        );

        let total_proceeds = raffle
            .ticket_price_sol
            .checked_mul(raffle.tickets_sold)
            .ok_or(RaffleError::MathOverflow)?;

        // Seller payout: 90% of proceeds
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
            &[
                &[b"escrow", raffle.raffle_id.as_bytes(), &[ctx.bumps.escrow_account]],
            ],
        )?;

        // Platform revenue: 10% of proceeds
        let platform_revenue = total_proceeds
            .checked_div(10)
            .ok_or(RaffleError::MathOverflow)?;

        // Charity contribution: 10% of platform revenue (1% of total proceeds)
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
            &[
                &[b"escrow", raffle.raffle_id.as_bytes(), &[ctx.bumps.escrow_account]],
            ],
        )?;

        emit!(PayoutProcessed {
            raffle_id: raffle.raffle_id.clone(),
            seller_payout,
            platform_revenue,
            charity_contribution,
        });

        Ok(())
    }

    // Process payout for a fractional sale with minting tokens (allow_fractional = true)
    pub fn process_payout_fractional_with_mint(ctx: Context<ProcessPayoutFractionalWithMint>) -> Result<()> {
        let raffle = &mut ctx.accounts.raffle;
        require!(raffle.is_completed, RaffleError::RaffleNotClosed);
        require!(
            raffle.tickets_sold != raffle.total_tickets,
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

        // Validate escrow_account
        let expected_escrow_key = Pubkey::find_program_address(
            &[b"escrow", raffle.raffle_id.as_bytes()],
            &ctx.program_id,
        ).0;
        require!(
            ctx.accounts.escrow_account.key() == expected_escrow_key,
            RaffleError::InvalidEscrowAccount
        );
        require!(
            ctx.accounts.escrow_account.owner == &anchor_lang::solana_program::system_program::ID,
            RaffleError::InvalidEscrowAccount
        );

        // Validate charity_account
        require!(
            ctx.accounts.charity_account.owner == &anchor_lang::solana_program::system_program::ID,
            RaffleError::InvalidCharityAccount
        );

        // Deserialize and validate accounts
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

        // Seller payout: 90% of proceeds
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
            &[
                &[b"escrow", raffle.raffle_id.as_bytes(), &[ctx.bumps.escrow_account]],
            ],
        )?;

        // Platform revenue: 10% of proceeds
        let platform_revenue = total_proceeds
            .checked_div(10)
            .ok_or(RaffleError::MathOverflow)?;

        // Charity contribution: 10% of platform revenue (1% of total proceeds)
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
            &[
                &[b"escrow", raffle.raffle_id.as_bytes(), &[ctx.bumps.escrow_account]],
            ],
        )?;

        // Mint remaining tokens to seller
        let total_tokens = 1_000_000; // 1M tokens = 100% ownership
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
    /// CHECK: This account will be manually validated in the instruction logic.
    #[account(
        init,
        payer = seller,
        space = 8,
        seeds = [b"escrow", raffle.raffle_id.as_bytes()],
        bump
    )]
    pub escrow_account: AccountInfo<'info>,
    /// CHECK: This is the mint for the property NFT, used for metadata creation and validated in process_payout_full_sale.
    #[account(mut)]
    pub property_nft_mint: AccountInfo<'info>,
    /// CHECK: This is the mint for the fractional token, used for metadata creation and validated in refund_or_distribute and process_payout_fractional_with_mint.
    #[account(mut)]
    pub property_token_mint: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    /// CHECK: This is the Metaplex Token Metadata program, validated by its program ID in the instruction.
    pub metadata_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct PurchaseTicket<'info> {
    #[account(mut)]
    pub raffle: Account<'info, Raffle>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: This is the buyer's token account, deserialized and validated in the instruction logic.
    #[account(mut)]
    pub buyer_token_account: AccountInfo<'info>,
    /// CHECK: This account will be manually validated in the instruction logic.
    #[account(
        mut,
        seeds = [b"escrow", raffle.raffle_id.as_bytes()],
        bump
    )]
    pub escrow_account: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestRandomness<'info> {
    #[account(mut)]
    pub raffle: Account<'info, Raffle>,
    /// CHECK: This account will be manually validated in the instruction logic.
    #[account(
        mut,
        seeds = [b"escrow", raffle.raffle_id.as_bytes()],
        bump
    )]
    pub escrow_account: AccountInfo<'info>,
    /// CHECK: This is a placeholder for the Chainlink VRF program on Devnet, invoked using a hardcoded program ID.
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
    /// CHECK: This account will be manually validated in the instruction logic.
    #[account(
        mut,
        seeds = [b"escrow", raffle.raffle_id.as_bytes()],
        bump
    )]
    pub escrow_account: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct RefundOrDistribute<'info> {
    #[account(mut)]
    pub raffle: Account<'info, Raffle>,
    /// CHECK: This account will be manually validated in the instruction logic.
    #[account(
        mut,
        seeds = [b"escrow", raffle.raffle_id.as_bytes()],
        bump
    )]
    pub escrow_account: AccountInfo<'info>,
    #[account(mut)]
    pub seller: Signer<'info>,
    /// CHECK: This account will be manually validated in the instruction logic.
    #[account(mut)]
    pub holder_account: AccountInfo<'info>,
    /// CHECK: This is the holder's token account, deserialized and validated in the instruction logic.
    #[account(mut)]
    pub holder_token_account: AccountInfo<'info>,
    /// CHECK: This is the mint for the fractional token, deserialized and validated in the instruction logic.
    #[account(mut)]
    pub property_token_mint: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ProcessPayoutFullSale<'info> {
    #[account(mut)]
    pub raffle: Account<'info, Raffle>,
    /// CHECK: This account will be manually validated in the instruction logic.
    #[account(
        mut,
        seeds = [b"escrow", raffle.raffle_id.as_bytes()],
        bump
    )]
    pub escrow_account: AccountInfo<'info>,
    #[account(mut)]
    pub seller: Signer<'info>,
    /// CHECK: This account will be manually validated in the instruction logic.
    #[account(mut)]
    pub charity_account: AccountInfo<'info>,
    /// CHECK: This is the seller's token account holding the property NFT, deserialized and validated in the instruction logic.
    #[account(mut)]
    pub property_nft_account: AccountInfo<'info>,
    /// CHECK: This is the winner's token account to receive the property NFT, deserialized and validated in the instruction logic.
    #[account(mut)]
    pub winner_nft_account: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ProcessPayoutFractionalNoMint<'info> {
    #[account(mut)]
    pub raffle: Account<'info, Raffle>,
    /// CHECK: This account will be manually validated in the instruction logic.
    #[account(
        mut,
        seeds = [b"escrow", raffle.raffle_id.as_bytes()],
        bump
    )]
    pub escrow_account: AccountInfo<'info>,
    #[account(mut)]
    pub seller: Signer<'info>,
    /// CHECK: This account will be manually validated in the instruction logic.
    #[account(mut)]
    pub charity_account: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ProcessPayoutFractionalWithMint<'info> {
    #[account(mut)]
    pub raffle: Account<'info, Raffle>,
    /// CHECK: This account will be manually validated in the instruction logic.
    #[account(
        mut,
        seeds = [b"escrow", raffle.raffle_id.as_bytes()],
        bump
    )]
    pub escrow_account: AccountInfo<'info>,
    #[account(mut)]
    pub seller: Signer<'info>,
    /// CHECK: This is the seller's token account to receive fractional tokens, deserialized and validated in the instruction logic.
    #[account(mut)]
    pub seller_token_account: AccountInfo<'info>,
    /// CHECK: This account will be manually validated in the instruction logic.
    #[account(mut)]
    pub charity_account: AccountInfo<'info>,
    /// CHECK: This is the mint for the fractional token, deserialized and validated in the instruction logic.
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
    #[msg("Fractional ownership is allowed, use process_payout_fractional_with_mint")]
    FractionalOwnershipAllowed,
    #[msg("Fractional ownership is not allowed, use process_payout_fractional_no_mint")]
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
}

// Unit Tests
#[cfg(test)]
mod tests {
    use super::*;
    

    // Helper function to create a Raffle for testing
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

        // Simulate the logic of initialize_raffle (without CPI calls)
        raffle.raffle_id = "raffle1".to_string();
        raffle.property_id = "property1".to_string();
        raffle.seller = seller;
        raffle.escrow_account = escrow_account;
        raffle.ticket_price_sol = 1_000_000; // 1 SOL in lamports
        raffle.total_tickets = 10_000;
        raffle.tickets_sold = 0;
        raffle.winner = None;
        raffle.property_nft_mint = property_nft_mint;
        raffle.property_token_mint = property_token_mint;
        raffle.is_completed = false;
        raffle.allow_fractional = true;
        raffle.ticket_holders = Vec::new();
        raffle.random_value = None;

        // Assertions
        assert_eq!(raffle.raffle_id, "raffle1");
        assert_eq!(raffle.property_id, "property1");
        assert_eq!(raffle.ticket_price_sol, 1_000_000);
        assert_eq!(raffle.total_tickets, 10_000);
        assert_eq!(raffle.tickets_sold, 0);
        assert_eq!(raffle.is_completed, false);
        assert_eq!(raffle.allow_fractional, true);
        assert!(raffle.ticket_holders.is_empty());
    }

    #[test]
    fn test_purchase_ticket_logic() {
        let mut raffle = create_raffle();
        raffle.raffle_id = "raffle1".to_string();
        raffle.property_id = "property1".to_string();
        raffle.seller = Pubkey::new_unique();
        raffle.escrow_account = Pubkey::new_unique();
        raffle.ticket_price_sol = 1_000_000; // 1 SOL in lamports
        raffle.total_tickets = 10_000;
        raffle.tickets_sold = 0;
        raffle.is_completed = false;

        let buyer = Pubkey::new_unique();
        let buyer_token_account = Pubkey::new_unique();
        let num_tickets = 2;

        // Simulate the logic of purchase_ticket (without CPI calls)
        assert!(!raffle.is_completed);
        assert!(raffle.tickets_sold + num_tickets <= raffle.total_tickets);

        // Skip the transfer CPI call and directly update the state
        if let Some(holder) = raffle.ticket_holders.iter_mut().find(|h| h.buyer == buyer) {
            holder.num_tickets += num_tickets;
        } else {
            raffle.ticket_holders.push(TicketHolder {
                buyer,
                num_tickets,
                token_account: buyer_token_account,
            });
        }
        raffle.tickets_sold += num_tickets;

        // Assertions
        assert_eq!(raffle.tickets_sold, num_tickets);
        assert_eq!(raffle.ticket_holders.len(), 1);
        assert_eq!(raffle.ticket_holders[0].buyer, buyer);
        assert_eq!(raffle.ticket_holders[0].num_tickets, num_tickets);
    }
}

