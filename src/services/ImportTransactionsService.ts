import { getCustomRepository, getRepository, In } from 'typeorm';
import csvParse from 'csv-parse';
import fs from 'fs';

import Transaction from '../models/Transaction';
import Category from '../models/Category';

import TransactionRepository from '../repositories/TransactionsRepository';

interface CVVTransaction {
  title: string;
  type: 'income' | 'outcome';
  value: number;
  category: string;
}

class ImportTransactionsService {
  async execute(filePath: string): Promise<Transaction[]> {
    const transactionRepository = getCustomRepository(TransactionRepository);
    const categoriesRepository = getRepository(Category);

    const contactReadStream = fs.createReadStream(filePath);

    // Ignora o cabeçalho
    const parsers = csvParse({
      from_line: 2,
    });

    // Lê as linhas conforme estão disponíveis
    const parseCSV = contactReadStream.pipe(parsers);

    // Criamos essas variáveis para salvarmos de uma vez só no banco de dados
    const transactions: CVVTransaction[] = [];
    const categories: string[] = [];

    parseCSV.on('data', async line => {
      const [title, type, value, category] = line.map((cell: string) =>
        cell.trim(),
      );

      // Verifica se é uma transação
      if (!title || !type || !value) return;

      categories.push(category);
      transactions.push({ title, type, value, category });
    });

    // Lê o arquivo de uma só vez
    await new Promise(resolve => parseCSV.on('end', resolve));

    // Verifica a existência de uma categoria no banco
    const existentCategories = await categoriesRepository.find({
      where: {
        title: In(categories),
      },
    });

    // Procura o título das categorias que existem no banco
    const existentCategoriesTitles = existentCategories.map(
      (category: Category) => category.title,
    );

    // Adiciona as categorias novas e exclui as duplicadas
    const addCategoryTitles = categories
      .filter(category => !existentCategoriesTitles.includes(category))
      .filter((value, index, self) => self.indexOf(value) === index);

    // Cria a categoria em forma de objeto
    const newCategories = categoriesRepository.create(
      addCategoryTitles.map(title => ({
        title,
      })),
    );

    await categoriesRepository.save(newCategories);

    const finalCategories = [...newCategories, ...existentCategories];

    const createdTransactions = transactionRepository.create(
      transactions.map(transaction => ({
        title: transaction.title,
        type: transaction.type,
        value: transaction.value,
        category: finalCategories.find(
          category => category.title === transaction.category,
        ),
      })),
    );
    await transactionRepository.save(createdTransactions);

    await fs.promises.unlink(filePath);

    return createdTransactions;
  }
}

export default ImportTransactionsService;
